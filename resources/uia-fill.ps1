# ScreenPilot AI — assisted form fill.
#
# Types a value into ONE control the user has explicitly approved. Never submits anything:
# no Enter, no clicking Search/Submit. The user always performs the final action themselves.
#
# Targeting is by virtual-desktop rectangle plus name, matched inside the foreground window,
# so we act on the exact control the user saw in the approval card.
#
# Contract: writes a single JSON object { ok: bool, error: string|null } and exits 0.

param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$W,
  [Parameter(Mandatory = $true)][int]$H,
  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Name,
  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
)

$ErrorActionPreference = 'Stop'

function Write-Result([bool]$ok, [string]$err) {
  [pscustomobject]@{ ok = $ok; error = $err } | ConvertTo-Json -Compress
  exit 0
}

# SendKeys assigns special meaning to these; braces escape them literally.
function ConvertTo-SendKeysLiteral([string]$text) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    if ('+^%~(){}[]'.Contains($ch)) { [void]$sb.Append('{').Append($ch).Append('}') }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms

  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SpFill {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

  $hwnd = [SpFill]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { Write-Result $false 'No foreground window.' }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if ($null -eq $root) { Write-Result $false 'Could not read the active window.' }

  # Find the control whose rectangle matches what the user approved. A few pixels of drift is
  # normal between the probe and the fill, so match on centre-point containment.
  $centreX = $X + ($W / 2)
  $centreY = $Y + ($H / 2)

  $onScreen = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsOffscreenProperty, $false)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $onScreen)

  $target = $null
  $bestArea = [double]::MaxValue
  foreach ($el in $all) {
    try {
      $c = $el.Current
      $r = $c.BoundingRectangle
      if ([double]::IsInfinity($r.X) -or $r.Width -le 0) { continue }
      if (-not $c.IsKeyboardFocusable) { continue }
      if ($centreX -lt $r.X -or $centreX -gt ($r.X + $r.Width)) { continue }
      if ($centreY -lt $r.Y -or $centreY -gt ($r.Y + $r.Height)) { continue }
      # Prefer the tightest control containing that point — the field itself, not its wrapper.
      $area = $r.Width * $r.Height
      if ($area -lt $bestArea) { $bestArea = $area; $target = $el }
    } catch { continue }
  }

  if ($null -eq $target) { Write-Result $false 'That field is no longer on screen. Nothing was typed.' }

  $target.SetFocus()
  Start-Sleep -Milliseconds 120

  # Refuse to type unless focus actually landed on the intended control — otherwise the
  # keystrokes would go wherever focus happens to be, which could be anything.
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $focusOk = $false
  if ($null -ne $focused) {
    $fr = $focused.Current.BoundingRectangle
    if (-not [double]::IsInfinity($fr.X)) {
      $focusOk = ($centreX -ge $fr.X -and $centreX -le ($fr.X + $fr.Width) -and
                  $centreY -ge $fr.Y -and $centreY -le ($fr.Y + $fr.Height))
    }
  }
  if (-not $focusOk) { Write-Result $false 'Could not focus that field safely, so nothing was typed.' }

  # Select-all then type, so the field is replaced rather than appended to. Real keystrokes
  # (rather than ValuePattern.SetValue) are what make web frameworks register the change.
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 60
  [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $Value))

  Write-Result $true $null
} catch {
  Write-Result $false $_.Exception.Message
}
