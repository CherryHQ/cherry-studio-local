import { ChildProcess, exec } from 'child_process'
import { app } from 'electron'
import logger from 'electron-log'
const fs = require('fs')
const net = require('net')
const path = require('path')

const executable = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
// const os = process.platform === 'win32' ? 'win' : 'mac'
const port = 15537

let ollmaPath: string
let binPath: string
// let ollamaModelsPath: string

if (app.isPackaged) {
  ollmaPath = path.join(process.resourcesPath, 'ollama')
  binPath = path.join(ollmaPath, 'bin')
  // ollamaModelsPath = path.join(ollmaPath, 'models')
} else {
  ollmaPath = path.join(__dirname, '..', '..', 'ollama')
  binPath = path.join(process.cwd(), 'resources', 'ollama')
  // ollamaModelsPath = path.join(ollmaPath, 'models')
}

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

// 运行 Ollama 的函数
const runOllama = async (): Promise<ChildProcess | null> => {
  // 首先检查 port 端口是否已被占用
  const portInUse = await isPortInUse(port)

  if (portInUse) {
    logger.log('Ollama is already running on port port')
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
  // const env = {
  //   ...process.env,
  //   OLLAMA_MODELS: ollamaModelsPath,
  //   OLLAMA_HOST: `0.0.0.0:${port}`
  // }

  const ollamaProcess = exec(ollamaExecutable)
  // 运行 Ollama
  // const ollamaProcess = spawn(ollamaExecutable, ['serve'], {
  //   stdio: 'pipe',
  //   detached: false,
  //   env: env,
  //   windowsHide: true
  // })

  // 处理输出
  ollamaProcess.stdout?.on('data', (data: Buffer) => {
    logger.log(`Ollama stdout: ${data}`)
  })

  ollamaProcess.stderr?.on('data', (data: Buffer) => {
    logger.error(`Ollama stderr: ${data}`)
  })

  ollamaProcess.on('close', (code: number | null) => {
    logger.log(`Ollama process exited with code ${code}`)
  })

  // 返回进程对象，以便后续管理
  return ollamaProcess
}

async function start() {
  try {
    const ollamaProcess = await runOllama()

    if (ollamaProcess) {
      logger.log('Ollama has been started')

      // 如果需要在应用退出时关闭 Ollama，可以添加以下代码：
      app.on('will-quit', () => {
        if (ollamaProcess) {
          ollamaProcess.kill()
          logger.log('Ollama serve is quit')
        }
      })
    } else {
      logger.log('Ollama was already running, no new process started')
    }

    // 可以在这里添加其他的初始化代码
  } catch (error) {
    logger.error('Error running Ollama:', error)
  }
}

start()
