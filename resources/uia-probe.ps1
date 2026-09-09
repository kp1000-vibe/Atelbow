# ScreenPilot AI — Windows UI Automation probe.
#
# Emits a JSON array of on-screen, interactive controls belonging to the FOREGROUND window
# only (never a whole-desktop walk — see the privacy notes in the phase 3 plan).
#
# Contract with the Node side: this script writes a single JSON object to stdout and nothing
# else — { window: {x,y,w,h,title} | null, elements: [...] }. Coordinates are VIRTUAL-DESKTOP
# pixels (they can exceed the primary display, or be negative, on multi-monitor setups); the
# Node side uses `window` to decide which display to screenshot and to rebase the rects.
#
# On any failure it writes an empty result and exits 0, because a missing accessibility tree
# must degrade ScreenPilot to vision-only behaviour rather than break the ask flow.

$ErrorActionPreference = 'Stop'

# Names longer than this are page paragraphs, not labels — they blow the token budget.
$MaxNameLength = 80
$MaxElements = 150
# Containers this large are layout wrappers ("the whole page"), never a click target.
$MaxAreaFraction = 0.9

# Higher wins when the same visual control appears at several tree depths.
$RolePriority = @{
  'Button' = 100; 'Hyperlink' = 95; 'MenuItem' = 90; 'TabItem' = 88; 'Tab' = 86
  'CheckBox' = 84; 'RadioButton' = 82; 'ComboBox' = 80; 'Edit' = 78; 'Slider' = 70
  'ListItem' = 60; 'TreeItem' = 58; 'Text' = 20
}

function Write-Empty { Write-Output '{"window":null,"elements":[]}'; exit 0 }

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SpForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

  $hwnd = [SpForeground]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { Write-Empty }

  $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if ($null -eq $rootEl) { Write-Empty }

  $rootRect = $rootEl.Current.BoundingRectangle
  if ([double]::IsInfinity($rootRect.Width) -or $rootRect.Width -le 0) { Write-Empty }
  $maxArea = $rootRect.Width * $rootRect.Height * $MaxAreaFraction

  # Only on-screen elements; offscreen ones are scrolled out of view or not rendered.
  $onScreen = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $false)
  $found = $rootEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $onScreen)

  $candidates = New-Object System.Collections.ArrayList

  foreach ($el in $found) {
    try {
      $cur = $el.Current
      $rect = $cur.BoundingRectangle

      # Unrendered elements report an infinite rect — converting these to int throws.
      if ([double]::IsInfinity($rect.X) -or [double]::IsInfinity($rect.Width)) { continue }
      if ($rect.Width -le 1 -or $rect.Height -le 1) { continue }
      if (($rect.Width * $rect.Height) -gt $maxArea) { continue }

      $role = $cur.ControlType.ProgrammaticName -replace 'ControlType\.', ''
      if (-not $RolePriority.ContainsKey($role)) { continue }

      $name = $cur.Name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $name = ($name -replace '\s+', ' ').Trim()
      if ($name.Length -gt $MaxNameLength) { $name = $name.Substring(0, $MaxNameLength - 1) + [char]0x2026 }

      [void]$candidates.Add([pscustomobject]@{
        name     = $name
        role     = $role
        priority = $RolePriority[$role]
        x        = [int][Math]::Round($rect.X)
        y        = [int][Math]::Round($rect.Y)
        w        = [int][Math]::Round($rect.Width)
        h        = [int][Math]::Round($rect.Height)
        enabled  = [bool]$cur.IsEnabled
      })
    } catch {
      # A control can be destroyed mid-walk (menus, transient popups). Skip it.
      continue
    }
  }

  # Deduplicate: the same visual control typically appears as nested Custom/Button/Text nodes
  # with near-identical rects. Group by name + rounded position, keep the most interactive.
  $deduped = $candidates |
    Group-Object { "$($_.name)|$([Math]::Round($_.x / 8))|$([Math]::Round($_.y / 8))" } |
    ForEach-Object { $_.Group | Sort-Object -Property priority -Descending | Select-Object -First 1 }

  # Prefer interactive controls over plain Text when trimming to the cap, but keep
  # document order within a priority band so the list still reads top-to-bottom.
  $ordered = $deduped | Sort-Object -Property @{Expression = 'priority'; Descending = $true} |
    Select-Object -First $MaxElements

  $result = $ordered | ForEach-Object {
    [pscustomobject]@{
      name = $_.name; role = $_.role
      x = $_.x; y = $_.y; w = $_.w; h = $_.h
      enabled = $_.enabled
    }
  }

  $payload = [pscustomobject]@{
    window = [pscustomobject]@{
      x     = [int][Math]::Round($rootRect.X)
      y     = [int][Math]::Round($rootRect.Y)
      w     = [int][Math]::Round($rootRect.Width)
      h     = [int][Math]::Round($rootRect.Height)
      title = $rootEl.Current.Name
    }
    # @() forces an array even when zero or one element survived filtering.
    elements = @($result)
  }

  Write-Output ($payload | ConvertTo-Json -Compress -Depth 4)
} catch {
  Write-Empty
}
