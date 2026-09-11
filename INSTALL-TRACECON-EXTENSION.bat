@echo off
setlocal
set "ROOT=%~dp0"
set "DIST=%ROOT%dist-extension"

echo.
echo ======================================================
echo   TRACECON EXTENSION - PREPARAR INSTALACAO LOCAL
echo ======================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js 22 ou mais recente e execute este arquivo novamente.
  pause
  exit /b 1
)

pushd "%ROOT%"
call npm run build:extension
if errorlevel 1 (
  echo.
  echo O build da extensao falhou. Veja a mensagem acima.
  popd
  pause
  exit /b 1
)
node -e "JSON.parse(require('fs').readFileSync('dist-extension/manifest.json','utf8')); console.log('Manifest V3 valido.')"
if errorlevel 1 (
  echo Manifest invalido. Nenhuma instalacao deve ser feita.
  popd
  pause
  exit /b 1
)
echo.
echo TRACECON EXTENSION PRONTA
echo.
echo 1. Ative "Modo do desenvolvedor" na pagina que abrira.
echo 2. Clique "Carregar sem compactacao".
echo 3. Selecione exatamente esta pasta:
echo.
echo %DIST%
echo.
echo 4. Fixe o TraceCon na barra do navegador.
echo 5. Inicie o TraceCon e abra a IQ Option.
echo.
start "" chrome.exe "chrome://extensions"
if errorlevel 1 start "" msedge.exe "edge://extensions"
popd
pause
