@echo off

start "IPEX-LLM Ollama Serve" cmd /k "cd /d %~dp0 && ollama-serve.bat"
