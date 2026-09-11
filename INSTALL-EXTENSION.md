# Instalar a extensão TraceCon

Pasta para instalar: `C:\Users\junin\Documents\Codex\2026-09-11\gh-repo-clone-wmagencia-tracecom\tracecom\dist-extension`

Antes, dê dois cliques em `INSTALL-TRACECON-EXTENSION.bat` na pasta do projeto. Ele prepara a pasta e abre a tela certa do navegador.

## Google Chrome

1. Na página aberta, ative **Modo do desenvolvedor** (canto superior direito).
2. Clique em **Carregar sem compactação**.
3. Selecione a pasta `dist-extension` indicada acima.
4. Fixe o ícone **TraceCon** na barra do Chrome.

## Microsoft Edge

1. Abra `edge://extensions`.
2. Ative **Modo de desenvolvedor** (canto inferior esquerdo).
3. Clique em **Carregar sem pacote**.
4. Selecione a mesma pasta `dist-extension`.
5. Fixe o ícone **TraceCon** na barra do Edge.

## Primeiro teste na IQ Option

1. No PowerShell, dentro da pasta do projeto, execute `$env:MARKET_DATA_MODE='iqoption'; npm run serve`.
   No Prompt de Comando (cmd), use `set MARKET_DATA_MODE=iqoption && npm run serve`.
2. Abra a IQ Option e entre normalmente na sua conta demo.
3. Abra o gráfico **EUR/USD** e selecione **M1**.
4. Clique no ícone TraceCon. O painel deve mostrar `Backend: CONECTADO`, `IQ Option: DETECTADA` e, após o primeiro candle, `Market Feed: HEALTHY`.
5. Em **Diagnóstico**, confira a sequência: `PAGE DETECTED`, `BRIDGE ACTIVE`, `FRAME RECEIVED`, `INGEST OK` e `PROVIDER HEALTHY`.

A extensão é somente leitura: não solicita credenciais, não lê cookies/sessão e não envia nem clica em ordens de compra ou venda.
