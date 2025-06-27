0. Check your GPU driver version, and update it if needed:
   - For Intel Core Ultra processors (Series 2) or Intel Arc B-Series GPU, we recommend updating your GPU driver to the latest (https://www.intel.com/content/www/us/en/download/785597/intel-arc-iris-xe-graphics-windows.html)
   - For other Intel iGPU/dGPU, we recommend using GPU driver version 32.0.101.6078 (https://www.intel.com/content/www/us/en/download/785597/834050/intel-arc-iris-xe-graphics-windows.html)

1. Extract the zip file to a folder

2. Start Ollama serve as follows:
   - Open "Command Prompt" (cmd), enter the extracted folder by "cd /d PATH\TO\EXTRACTED\FOLDER"
   - Run "start-ollama.bat" in the "Command Prompt", and then a window will pop up for Ollama serve

3. In the same "Command Prompt" (not the pop-up window), run "ollama run deepseek-r1:7b" (you may use any other model)
