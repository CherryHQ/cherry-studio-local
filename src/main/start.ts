import { ChildProcess, exec, spawn } from 'child_process'
import { app } from 'electron'
import logger from 'electron-log'

import { getResourcePath } from './utils'
const fs = require('fs')
const net = require('net')
const path = require('path')

const executable = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
// const os = process.platform === 'win32' ? 'win' : 'mac'
const port = 11434

// let ollamaModelsPath: string

// 使用统一的资源路径处理
const resourcesPath = getResourcePath()
const ollmaPath: string = path.join(resourcesPath, 'ollama')
const binPath: string = ollmaPath

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

// 强制关闭ollama相关进程
const killOllamaProcesses = (): Promise<void> => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows平台使用taskkill命令
      const commands = ['taskkill /F /IM ollama.exe /T', 'taskkill /F /IM ollama-lib.exe /T']

      let completedCommands = 0
      const totalCommands = commands.length

      commands.forEach((command) => {
        exec(command, (error, _stdout, _stderr) => {
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
    } else {
      // macOS/Linux平台使用pkill命令
      const commands = ['pkill -f ollama', 'pkill -f ollama-lib']

      let completedCommands = 0
      const totalCommands = commands.length

      commands.forEach((command) => {
        exec(command, (error, _stdout, _stderr) => {
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
    }
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

  // 确保文件存在并且可执行
  if (!fs.existsSync(ollamaExecutable)) {
    throw new Error(`Ollama executable not found: ${ollamaExecutable}`)
  }

  // 在 macOS 和 Linux 上设置可执行权限
  if (process.platform !== 'win32') {
    fs.chmodSync(ollamaExecutable, '755')
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
    OLLAMA_HOST: `127.0.0.1:${port}`
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
    // 首先尝试优雅地关闭主进程
    if (ollamaMainProcess && !ollamaMainProcess.killed) {
      logger.log('Gracefully closing main Ollama process...')
      ollamaMainProcess.kill('SIGTERM')

      // 等待一段时间让进程优雅退出
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    // 强制关闭所有相关进程
    logger.log('Force killing all Ollama processes...')
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
