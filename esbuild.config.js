const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const copyFiles = (srcDir = path.join(__dirname, 'public'), destDir = path.join(__dirname, 'dist')) => {
  fs.readdirSync(srcDir).forEach((file) => {
    const source = path.join(srcDir, file);
    const destination = path.join(destDir, file);

    if (fs.lstatSync(source).isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      copyFiles(source, destination);  // Recursively copy subdirectories
    } else {
      fs.copyFileSync(source, destination);
    }
  });
};

esbuild.build({
  entryPoints: [
    "src/popup.tsx",
    "src/background.ts"
  ],
  bundle: true,
  outdir: "dist",
  minify: true,
  sourcemap: true,
  loader: {
    ".png": "file"
  },
  define: {
    "process.env.NODE_ENV": '"production"'
  },
}).then(() => {
  copyFiles();
  console.log("✅ Build and static files copied to dist/");
}).catch(() => process.exit(1));
