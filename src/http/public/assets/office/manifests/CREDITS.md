# Créditos e Licenças — Assets do Escritório

Todos os sprites desta pasta são **arte original do TraceCom**, gerada de forma
reprodutível por `scripts/office-assets/generate.mjs` (MIT, mesma licença do projeto).

Referências visuais/arquiteturais (nenhum arquivo importado):
- [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) — MIT. Referência de
  proporção de personagens, pipeline de manifests e organização de assets.
- [JIK-A-4 · MetroCity (CC0 1.0)](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) — referência
  de linguagem visual "chibi top-down" usada pelo Pixel Agents. Como é CC0, poderia ser importado, mas
  optamos por arte própria isométrica para manter estilo 100% consistente e editável.
- [donarg · Office Interior Tileset](https://donarg.itch.io/officetileset) — citado na documentação do Pixel
  Agents como referência de tileset; não utilizado.

## Como substituir/expandir
1. Coloque um PNG + manifest.json em `assets/office/<categoria>/<id>/`.
2. Registre o caminho no índice `manifests/office-assets.json` **ou** rode o gerador.
3. O renderer carrega tudo pelo manifest — não é preciso tocar no código de desenho.
