const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// A simple pigeon icon SVG - stylized dove/pigeon in a rounded square
const pigeonSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background with rounded corners -->
  <rect width="512" height="512" rx="80" fill="#6366f1"/>
  
  <!-- Pigeon body - stylized dove shape -->
  <g transform="translate(56, 80)">
    <!-- Main body -->
    <ellipse cx="200" cy="220" rx="120" ry="100" fill="white"/>
    
    <!-- Head -->
    <circle cx="280" cy="140" r="60" fill="white"/>
    
    <!-- Beak -->
    <path d="M330 150 L380 145 L340 165 Z" fill="#f59e0b"/>
    
    <!-- Eye -->
    <circle cx="300" cy="130" r="12" fill="#1e1e1e"/>
    <circle cx="304" cy="126" r="4" fill="white"/>
    
    <!-- Wing -->
    <path d="M80 180 Q60 250 100 300 L200 280 Q180 220 200 180 Z" fill="#e0e7ff"/>
    <path d="M100 200 Q90 240 110 280" stroke="#c7d2fe" stroke-width="4" fill="none"/>
    <path d="M130 190 Q120 230 140 270" stroke="#c7d2fe" stroke-width="4" fill="none"/>
    
    <!-- Tail feathers -->
    <path d="M80 260 L20 320 L60 300 L10 350 L70 320 L40 380 L100 320 L150 280 Z" fill="#e0e7ff"/>
    
    <!-- Chest detail -->
    <ellipse cx="240" cy="240" rx="40" ry="50" fill="#f0f0f0"/>
    
    <!-- Feet -->
    <path d="M180 310 L170 360 L160 350 L170 360 L180 350 L170 360 L190 360" stroke="#f59e0b" stroke-width="8" stroke-linecap="round" fill="none"/>
    <path d="M240 310 L230 360 L220 350 L230 360 L240 350 L230 360 L250 360" stroke="#f59e0b" stroke-width="8" stroke-linecap="round" fill="none"/>
  </g>
</svg>
`;

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

async function generateIcons() {
  const svgBuffer = Buffer.from(pigeonSvg);
  
  // Generate PNG icons at various sizes
  const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 },
  ];
  
  for (const { name, size } of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, name));
    console.log(`Generated ${name}`);
  }
  
  // Generate ICO (Windows) - using 256x256 PNG as base
  // ICO needs special handling - we'll create a multi-size ICO
  const ico256 = await sharp(svgBuffer).resize(256, 256).png().toBuffer();
  const ico48 = await sharp(svgBuffer).resize(48, 48).png().toBuffer();
  const ico32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  const ico16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer();
  
  // For ICO, we'll use the 256 version and let Windows handle it
  // Sharp can't make true ICO, so we'll make a PNG that Windows can use
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(path.join(iconsDir, 'icon.ico.png'));
  
  // For macOS ICNS, we need a specific format - just use PNG for now
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon.icns.png'));
  
  console.log('\nNote: icon.ico.png and icon.icns.png created.');
  console.log('For proper ICO/ICNS, use these PNGs with a converter tool.');
  console.log('On Windows, you can rename icon.ico.png to icon.ico for basic usage.');
}

generateIcons().catch(console.error);
