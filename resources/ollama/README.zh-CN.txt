0. 我们推荐将你的 GPU 驱动版本升级到最新（https://www.intel.com/content/www/us/en/download/785597/intel-arc-iris-xe-graphics-windows.html） 

1. 把zip文件解压到文件夹

2. 根据如下步骤启动 Ollama serve:
   - 打开命令提示符（cmd），并通过在命令行输入指令 "cd /d PATH\TO\EXTRACTED\FOLDER" 进入解压缩后的文件夹
   - 在命令提示符中运行 "start-ollama.bat" ，随后 Ollama serve 会启动在弹出的窗口中

3. 在同一个命令提示符中（非弹出的窗口）运行 "ollama run deepseek-r1:7b"（你也可以使用任何其他模型）
