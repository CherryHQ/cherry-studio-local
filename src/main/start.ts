import { ChildProcess, exec, spawn } from 'child_process'
import { app } from 'electron'
import logger from 'electron-log'
const os = require('os')

const fs = require('fs')
const net = require('net')
const path = require('path')

const executable = 'ollama.exe'
const port = 11434

let ollmaPath: string
let binPath: string

// Set ollamaModelsPath first
const ollamaModelsPath = path.join(os.homedir(), '.cherrystudiointel', 'models')
fs.mkdirSync(ollamaModelsPath, { recursive: true })
// Create output directory structure
if (app.isPackaged) {
  ollmaPath = path.join(process.resourcesPath, 'ollama')
  binPath = ollmaPath
} else {
  ollmaPath = path.join(__dirname, '..', '..', 'ollama')
  binPath = ollmaPath
}

console.log('ollamaModelsPath', ollamaModelsPath)
logger.log('ollamaModelsPath', ollamaModelsPath)
console.log('ollmaPath', ollmaPath)
logger.log('ollmaPath', ollmaPath)
console.log('binPath', binPath)
logger.log('binPath', binPath)
// 存储启动的进程以便退出时清理
let ollamaMainProcess: ChildProcess | null = null

// 检查端口是否被占用
const isPortInUse = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        server.close()
        resolve(false)
      })
      .listen(port)
  })
}

// 强制关闭ollama相关进程 (Windows only)
const killOllamaProcesses = (): Promise<void> => {
  return new Promise((resolve) => {
    // Windows平台使用taskkill命令
    const commands = ['taskkill /F /IM ollama.exe /T', 'taskkill /F /IM ollama-lib.exe /T']

    let completedCommands = 0
    const totalCommands = commands.length

    commands.forEach((command) => {
      exec(command, (error) => {
        if (error) {
          logger.log(`Kill process command failed: ${command}, error: ${error.message}`)
        } else {
          logger.log(`Successfully executed: ${command}`)
        }

        completedCommands++
        if (completedCommands === totalCommands) {
          resolve()
        }
      })
    })
  })
}

// 运行 Ollama 的函数
const runOllama = async (): Promise<ChildProcess | null> => {
  // 首先检查 port 端口是否已被占用
  const portInUse = await isPortInUse(port)

  if (portInUse) {
    logger.log('Ollama is already running on port', port)
    return null // 返回 null 表示没有启动新的进程
  }

  const ollamaExecutable = path.join(binPath, executable)

  // 确保文件存在
  if (!fs.existsSync(ollamaExecutable)) {
    throw new Error(`Ollama executable not found: ${ollamaExecutable}`)
  }

  // 设置环境变量
  const env = {
    ...process.env,
    OLLAMA_NUM_GPU: '999',
    no_proxy: 'localhost,127.0.0.1',
    ZES_ENABLE_SYSMAN: '1',
    SYCL_CACHE_PERSISTENT: '1',
    OLLAMA_KEEP_ALIVE: '10m',
    OLLAMA_NUM_PARALLE: '2',
    OLLAMA_NUM_CTX: '32768',
    OLLAMA_HOST: `127.0.0.1:${port}`,
    OLLAMA_MODELS: ollamaModelsPath
  }
  // 运行 Ollama
  const ollamaProcess = spawn(ollamaExecutable, ['serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: env,
    windowsHide: true,
    cwd: binPath // 设置工作目录为 ollama.exe 所在目录
  })

  // 存储主进程引用
  ollamaMainProcess = ollamaProcess

  // 处理输出
  ollamaProcess.stdout?.setEncoding('utf8')
  ollamaProcess.stderr?.setEncoding('utf8')

  ollamaProcess.stdout?.on('data', (data: string) => {
    console.log(`Ollama: ${data.toString().trim()}`)
    logger.log(`Ollama stdout: ${data}`)
  })

  ollamaProcess.stderr?.on('data', (data: string) => {
    console.error(`Ollama Error: ${data.toString().trim()}`)
    logger.error(`Ollama stderr: ${data}`)
  })

  ollamaProcess.on('error', (error) => {
    console.error('Failed to start Ollama:', error)
    logger.error('Failed to start Ollama:', error)
  })

  ollamaProcess.on('close', (code: number | null) => {
    console.log(`Ollama process exited with code ${code}`)
    logger.log(`Ollama process exited with code ${code}`)
    ollamaMainProcess = null
  })

  // 返回进程对象，以便后续管理
  return ollamaProcess
}

// 清理所有ollama进程
const cleanupOllamaProcesses = async (): Promise<void> => {
  logger.log('Starting Ollama processes cleanup...')
  try {
    // 直接强制杀掉所有相关进程
    await killOllamaProcesses()
    logger.log('Ollama processes cleanup completed')
  } catch (error) {
    logger.error('Error during Ollama cleanup:', error)
  }
}

async function start() {
  try {
    const ollamaProcess = await runOllama()

    if (ollamaProcess) {
      console.log('Ollama has been started')
      logger.log('Ollama has been started')
    } else {
      console.log('Ollama was already running, no new process started')
      logger.log('Ollama was already running, no new process started')
    }

    // 注册退出时的清理函数
    const setupCleanupHandlers = () => {
      // 应用即将退出
      app.on('will-quit', async (event) => {
        event.preventDefault() // 阻止默认退出，等待清理完成

        await cleanupOllamaProcesses()

        // 清理完成后真正退出应用
        app.exit(0)
      })

      // 应用即将关闭（所有窗口关闭）
      app.on('before-quit', async (event) => {
        if (ollamaMainProcess) {
          event.preventDefault()
          await cleanupOllamaProcesses()
          app.quit()
        }
      })

      // 处理进程信号
      process.on('SIGINT', async () => {
        logger.log('Received SIGINT, cleaning up...')
        await cleanupOllamaProcesses()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        logger.log('Received SIGTERM, cleaning up...')
        await cleanupOllamaProcesses()
        process.exit(0)
      })
    }

    setupCleanupHandlers()

    // 可以在这里添加其他的初始化代码
  } catch (error) {
    console.error('Error running Ollama:', error)
    logger.error('Error running Ollama:', error)
  }
}

start()
