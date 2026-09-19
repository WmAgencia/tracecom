# INVENTÁRIO DE COMPONENTES DE TERCEIROS — Vibe-Trading & Fincept Terminal

- **Escopo:** Fase 2 — inventário de componentes de terceiros embutidos/vendorizados nos dois repos auditados,
  com origem, licença, arquivo de evidência e atribuição necessária. Nada foi copiado para o TraceCom.
- **Data:** 2026-09-19. Commits auditados: Vibe `e5f719567a0a8c943c08276b0295b95c572891fb`; Fincept `4ecda75fb35354b4a1d3a5c4d46fd7582fb0e2b5`.
- **Regra:** só entram no TraceCom componentes cuja licença permita e com atribuição registrada. AGPL/GPL/LGPL
  exigem análise jurídica e, no caso do código Fincept, **não reutilizar** (clean-room obrigatório).

## A. HKUDS/Vibe-Trading — repo MIT, com componentes embutidos licenciados

| Componente | Origem | Licença | Arquivo vendored/embutido | Evidência | Atribuição necessária |
|---|---|---|---|---|---|
| Microsoft Qlib — catálogo Alpha158 | github.com/microsoft/qlib, commit `d5379c520f66a39953bad76234a7019a72796fd0`, `qlib/contrib/data/handler.py` + `loader.py` | **Apache-2.0** | `agent/src/factors/zoo/qlib158/*` (re-expressão clean-room; headers por arquivo citam commit/path) | `agent/src/factors/zoo/qlib158/NOTICE`, `.../LICENSE.md` | Sim: copyright Microsoft + Apache-2.0 text + NOTICE + commit/path |
| Alpha101 (Kakushadze 2015) | arXiv:1601.00991 | Fórmulas = conteúdo factual não copyrightável; repo MIT no restante | `agent/src/factors/zoo/alpha101/*` | `.../alpha101/LICENSE.md` | Citar o paper (boa prática; exigido pelo stance do repo) |
| GTJA Alpha 191 | Guotai Junan Securities (2014), relatório público | Fórmulas (factual) | `agent/src/factors/zoo/gtja191/*` | `.../gtja191/LICENSE.md` | Citar o relatório; não reproduzir prosa/tabelas |
| Fatores acadêmicos (Fama-French 5, Carhart, HXZ q-factor) | Papers acadêmicos | Fórmulas (factual) | `agent/src/factors/zoo/academic/*` | `.../academic/LICENSE.md` | Citar os papers |
| Fontes Inter + JetBrains Mono via @fontsource 5.3.0 | rsms/inter; JetBrains/JetBrainsMono | **OFL-1.1** | `frontend/public/fonts/*` | `frontend/public/fonts/LICENSE` | Sim: OFL-1.1 + copyright dos autores (ao redistribuir o frontend) |

### Dependências de runtime do Vibe (não vendorizadas; instaladas via pip)

`pyproject.toml` / `requirements-lock.txt`: langchain & langgraph (MIT), fastapi/starlette (MIT/BSD), pydantic (MIT),
pandas/numpy/scipy (BSD-3), httpx (BSD-3), Pillow (MIT-CMU), pypdfium2 (Apache-2.0/BSD), python-docx (MIT),
python-pptx (MIT), openpyxl (MIT), rich (MIT), pyyaml (MIT), fastmcp/MCP SDK (MIT), key_value (Apache-2.0), etc.
Scan de GPL no lockfile: **nenhum** encontrado (`Select-String gpl` → vazio). Para redistribuição do binário,
gerar NOTICE agregado (a maioria é MIT/BSD/Apache e exige apenas texto de licença).

## B. Fincept-Corporation/FinceptTerminal — repo AGPL-3.0

| Componente | Origem | Licença | Arquivo/uso | Evidência | Atribuição / consequência |
|---|---|---|---|---|---|
| Fincept Terminal (código do repo) | Fincept Corporation | **AGPL-3.0** | todo o repo | `LICENSE` | **Não copiar para o TraceCom.** Copyleft forte com dever de rede; clean-room obrigatório |
| QZipReader/QZipWriter vendorizado | qt/qtbase branch 6.8, `src/corelib/io/qzip.cpp` (+ headers 6.8.3 SDK, 2 edits locais) | **LicenseRef-Qt-Commercial OR LGPL-3.0-only OR GPL-2.0-only OR GPL-3.0-only** | `fincept-qt/third_party/qzip/*` | `third_party/qzip/README.md` | Evitar; se um dia usar, cumprir LGPL/GPL (dinâmico/atribuição) |
| Qt 6 (Widgets, WebEngine, WebSockets, Multimedia, TTS, Wayland…) | qt.io / SDK | **LGPL-3.0 / GPL-2.0+ / GPL-3.0 / Comercial** | framework linkado | `find_package(Qt6 …)` no `CMakeLists.txt` | Uso de Qt pelo TraceCom não está em escopo (web) |
| QXlsx | github.com/QtExcel/QXlsx, tag v1.4.9 (`3192b80…`) | **MIT** | FetchContent | `fincept-qt/CMakeLists.txt` | Atribuição MIT se usado |
| md4c | github.com/mity/md4c, release-0.5.2 (`729e6b8…`) | **MIT** | FetchContent | idem | Atribuição MIT |
| QGeoView | github.com/AmonRaNet/QGeoView (`4b2c52c…`) | **LGPL-3.0** (verificar arquivo upstream) | FetchContent | idem | Copyleft fraco; cautela |
| Qt-Advanced-Docking-System 4.5.0 | githubuser0xFFFF (`87cffe5…`) | **LGPL-2.1** | FetchContent | idem | Copyleft fraco; cautela |
| ed25519 (orlp) | github.com/orlp/ed25519 (`b1f19fa…`) | **zlib** (permissiva) | FetchContent | idem | Atribuição zlib |
| KLineChart (klinecharts) | klinecharts upstream | **Apache-2.0** (confirmar header do bundle) | `fincept-qt/resources/charts/vendor/klinecharts.min.js` | arquivo minificado | Atribuição Apache + NOTICE se redistribuir |
| web3.js (bundle `solanaWeb3`) | web3.js / @solana | **MIT**; embute `ieee754` **BSD-3-Clause** (Feross Aboukhadijeh) — visível no bundle | `fincept-qt/resources/wallet/vendor/web3.js` | headers no bundle (`/*! ieee754. BSD-3-Clause … */`) | Atribuição MIT + BSD-3 se redistribuir |
| Wrappers Python de libs (pyportfolioopt, skfolio, statsmodels, vnpy, gs_quant, ffn, functime, gluonts, pmdarima, pypme, py_vollib, tsmoothie, fortitudo_tech, quantlib, …) | cada projeto upstream | MIT/BSD/Apache em sua maioria (conferir caso a caso) | `fincept-qt/scripts/Analytics/*_wrapper` (código wrapper é AGPL) | `resources/requirements-numpy1.txt` / `requirements-numpy2.txt` | **Não copiar wrappers**; usar as libs upstream diretamente sob suas próprias licenças, com atribuição |

## C. Conclusão de compatibilidade

1. **Vibe-Trading (MIT):** apto a reuso direto com atribuição; subcomponentes exigem:
   Apache-2.0 (qlib158) com NOTICE, OFL-1.1 (fontes) e citação de papers/fórmulas. Manter este inventário
   atualizado e agregar um `NOTICE` do TraceCom caso qualquer item seja incorporado.
2. **Fincept Terminal (AGPL-3.0):** **incompatível com cópia** nesta trilha. Qualquer adoção deve ser
   clean-room (desenho reescrito, testes próprios, nenhuma linha/prompt/schema derivado) e registrada com
   origem independente.
3. Nenhum componente AGPL/GPL/LGPL foi introduzido no TraceCom nesta rodada; nenhum arquivo dos repos foi copiado.
