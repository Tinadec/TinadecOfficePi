import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = resolve(desktopDir, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js')
const needsElectronNode = process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 24
const executable = needsElectronNode
  ? resolve(desktopDir, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.execPath
const env = needsElectronNode
  ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  : process.env

const result = spawnSync(executable, [viteCli, 'build'], {
  cwd: desktopDir,
  env,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
