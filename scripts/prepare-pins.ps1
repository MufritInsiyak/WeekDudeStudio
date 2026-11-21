Add-Type -AssemblyName System.Drawing

$srcDir = "C:\Users\Mufrit\.gemini\antigravity\brain\ea5333ee-d3cc-473d-a54b-b83c60daa756\.user_uploaded"
$destDirs = @("c:\Users\Mufrit\Documents\WeekDude\www\pins", "c:\Users\Mufrit\Documents\WeekDude\pins")

foreach ($d in $destDirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

# 1. Copy webp alt files directly
$altEvilSrc = Join-Path $srcDir "media_1794702554548_02e9f488.webp"
$altSmileSrc = Join-Path $srcDir "media_1794702554548_81f4947a.webp"

foreach ($d in $destDirs) {
    Copy-Item $altEvilSrc (Join-Path $d "alt-evil.webp") -Force
    Copy-Item $altSmileSrc (Join-Path $d "alt-smile.webp") -Force
}
Write-Host "Copied alt webp files successfully."

# 2. Process base-smile.png
# cfbf9b2f.png: badge center around (505.5, 456.5), diameter ~ 710px
# Let's crop to a square centered on the badge and resize to 512x512
$smileBmp = New-Object System.Drawing.Bitmap(Join-Path $srcDir "media_1794702584054_cfbf9b2f.png")
$scx = 505.5
$scy = 456.5
$sRadius = 360 # box size 760x760 gives a little margin around the 710px badge
$sBox = 760
$sRect = New-Object System.Drawing.RectangleF(($scx - $sBox/2), ($scy - $sBox/2), $sBox, $sBox)

$smile512 = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g1 = [System.Drawing.Graphics]::FromImage($smile512)
$g1.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g1.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g1.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$destRect = New-Object System.Drawing.Rectangle(0, 0, 512, 512)
$g1.DrawImage($smileBmp, $destRect, $sRect.X, $sRect.Y, $sRect.Width, $sRect.Height, [System.Drawing.GraphicsUnit]::Pixel)
$g1.Dispose()
$smileBmp.Dispose()

foreach ($d in $destDirs) {
    $smile512.Save((Join-Path $d "base-smile.png"), [System.Drawing.Imaging.ImageFormat]::Png)
}
Write-Host "Generated base-smile.png successfully."
$smile512.Dispose()

# 3. Process base-evil (85ff6477.jpg)
# Center around (510, 486.5), badge diameter ~ 800px.
# We also want to mask out the black square outside the circular badge so it has transparent background!
$evilBmp = New-Object System.Drawing.Bitmap(Join-Path $srcDir "media_1794702584014_85ff6477.jpg")
$ecx = 510.0
$ecy = 486.5
$eRadius = 402.0
$eBox = ($eRadius * 2) * (760.0 / 710.0) # match proportional margin of smile badge!
$eRect = New-Object System.Drawing.RectangleF(($ecx - $eBox/2), ($ecy - $eBox/2), $eBox, $eBox)

$evil512 = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g2 = [System.Drawing.Graphics]::FromImage($evil512)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Circular clip path for transparency outside badge
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$scale = 512.0 / $eBox
$clipRadius = $eRadius * $scale
$clipCx = 256.0
$clipCy = 256.0
$path.AddEllipse([float]($clipCx - $clipRadius), [float]($clipCy - $clipRadius), [float]($clipRadius * 2), [float]($clipRadius * 2))
$g2.SetClip($path)

$g2.DrawImage($evilBmp, $destRect, $eRect.X, $eRect.Y, $eRect.Width, $eRect.Height, [System.Drawing.GraphicsUnit]::Pixel)
$g2.Dispose()
$path.Dispose()
$evilBmp.Dispose()

foreach ($d in $destDirs) {
    $evil512.Save((Join-Path $d "base-evil.png"), [System.Drawing.Imaging.ImageFormat]::Png)
}
Write-Host "Generated base-evil.png successfully."
$evil512.Dispose()
