@echo off
setlocal

set OLLAMA_NUM_GPU=999
set no_proxy=localhost,127.0.0.1
set ZES_ENABLE_SYSMAN=1
set SYCL_CACHE_PERSISTENT=1
@REM This environment variable might improve performance.
@REM You could uncomment it and test whether it brings benefit for your case.
@REM set SYCL_PI_LEVEL_ZERO_USE_IMMEDIATE_COMMANDLISTS=1
set OLLAMA_KEEP_ALIVE=10m

set OLLAMA_NUM_PARALLEL=2
set OLLAMA_HOST=127.0.0.1:11434

cd /d %~dp0 && ollama.exe serve
