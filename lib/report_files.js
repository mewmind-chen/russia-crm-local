const fs = require('fs');
const path = require('path');

function isWithinRoot(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function hasAllowedExtension(file, allowedExtensions) {
  if (!allowedExtensions.length) return true;
  const extensions = allowedExtensions.map(value => String(value).toLowerCase());
  return extensions.includes(path.extname(file).toLowerCase());
}

function readExistingFileWithinRoot(rootPath, filePath, allowedExtensions = []) {
  if (!rootPath || !filePath) return null;
  let rootDescriptor;
  let descriptor;
  try {
    const root = fs.realpathSync(path.resolve(String(rootPath)));
    const file = fs.realpathSync(path.resolve(String(filePath)));
    if (!isWithinRoot(root, file) || !hasAllowedExtension(file, allowedExtensions)) return null;

    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const directory = fs.constants.O_DIRECTORY || 0;
    rootDescriptor = fs.openSync(root, fs.constants.O_RDONLY | directory | noFollow);
    const openedRootStat = fs.fstatSync(rootDescriptor);
    if (!openedRootStat.isDirectory()) return null;

    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) return null;

    const currentRootStat = fs.statSync(root);
    const verifiedFile = fs.realpathSync(file);
    const verifiedStat = fs.statSync(verifiedFile);
    if (currentRootStat.dev !== openedRootStat.dev
      || currentRootStat.ino !== openedRootStat.ino
      || !isWithinRoot(root, verifiedFile)
      || !hasAllowedExtension(verifiedFile, allowedExtensions)
      || openedStat.dev !== verifiedStat.dev
      || openedStat.ino !== verifiedStat.ino) return null;

    return { path: verifiedFile, content: fs.readFileSync(descriptor) };
  } catch (_error) {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (rootDescriptor !== undefined) fs.closeSync(rootDescriptor);
  }
}

module.exports = { readExistingFileWithinRoot };
