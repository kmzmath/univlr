@echo off
rem Gerador de cartinhas do Hub Uni.
rem Sobe o servidor estatico na raiz do Hub Uni (se ainda nao estiver no ar)
rem e abre o gerador no navegador. Mesmo esquema do previa-local.bat.
setlocal
cd /d "%~dp0..\.."

set "PORTA=8000"
set "PAGINA=http://localhost:%PORTA%/ferramentas/cartinhas/"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node nao encontrado no PATH. Instale o Node ou abra este .bat
  echo  de um terminal onde "node --version" funcione.
  echo.
  pause
  exit /b 1
)

call :porta_responde
if errorlevel 1 goto subir

echo  Servidor ja esta no ar na porta %PORTA%.
goto abrir

:subir
echo  Subindo o servidor na porta %PORTA%...
start "UNIVLR - servidor local" /min cmd /c "node local-static-server.cjs"

rem Espera a porta aceitar conexao, no maximo 20 segundos.
powershell -NoProfile -Command "$fim=(Get-Date).AddSeconds(20); while ((Get-Date) -lt $fim) { try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORTA%); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 300 } }; exit 1"
if errorlevel 1 (
  echo.
  echo  ERRO: o servidor nao subiu em 20s. Rode "node local-static-server.cjs"
  echo  a mao na pasta do Hub Uni para ver a mensagem de erro.
  echo.
  pause
  exit /b 1
)

:abrir
echo  Abrindo %PAGINA%
start "" "%PAGINA%"
echo.
echo  Fechar a janela minimizada "UNIVLR - servidor local" derruba o servidor.
ping -n 4 127.0.0.1 >nul 2>&1
exit /b 0

:porta_responde
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORTA%); $c.Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%
