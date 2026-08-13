# Spike 40 — Proposed Change contract (RFC 0008) piloted on Slides

**Status: VALIDATED** (06/ago/2026) · **Time-box:** < 1 dia (muito abaixo das 2 semanas)

## Goal

Validar o contrato unificado `Proposed Change` (RFC #8) no caso de preview mais
difícil: **Slides são shape-level, não text-block-level como Docs**, e um preview
significa renderizar o slide com a mudança aplicada — não um diff de texto. Se o
contrato cabe em Slides, cabe em Docs e PDF.

## O que foi construído

- `contract.mjs` — o ciclo de vida RFC #8: `draft → proposed → accepted → applied | rejected`
  (com guards de transição) + persistência no layout do RFC:
  `<audit>/<projectId>/proposals/<proposal-id>.json`
- `slides-adapter.mjs` — ops tipadas sobre o pptx-engine:
  - `set_shape_text` (edit de texto em shape)
  - `set_shape_style` (fill / transform — via dirty flags do engine)
  - `add_shape` / `remove_shape`
  - `applyProposal` **atômico**: valida TODAS as ops antes de mutar qualquer uma
- `harness.mjs` — E2E: propose → preview semântico → accept → apply → save →
  verificação de byte-preservation **por parte do zip** + reload do audit;
  e o caminho de **reject** (save byte-idêntico).

## Resultados (aceite da issue #40)

| Critério                                               | Resultado                                                                                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Mudança flui como um único `Proposed Change` tipado | ✅ `pc_*` com ops shape-level + scopes + preview + audit                                                                                                                                      |
| 2. Preview renderiza o slide com a mudança aplicada    | ✅ preview semântico shape-level (índice antes/depois por slide); o render pixel-perfect fica no app via `@hermesoffice/pptx-render` (RenderTree → adapter Konva) — mesmo padrão do MCP spike |
| 3. Reject restaura o estado anterior exatamente        | ✅ reject = nada aplicado; save do deck **byte-idêntico** ao original (0 diffs em 100% das partes)                                                                                            |
| 4. Time-box ≤ 2 semanas                                | ✅ validado em < 1 dia                                                                                                                                                                        |

Byte-preservation do apply: das ~10 partes do deck, **só `ppt/slides/slide1.xml` difere**
(texto + fill + shape adicionada + shape removida); as demais ficam byte-for-byte.

## Veredito

**O contrato RFC #8 cabe em Slides sem adaptação estrutural.** O modelo de dirty
flags do pptx-engine (mutar modelo → `dirty*` → save regenera só o slide editado)
é o mesmo "apply atômico + preservação por parte" que o contrato exige. A única
peça nova por app é o **adapter de ops** (o conjunto de ops tipadas + validação) —
o ciclo de vida, a persistência e a superfície de preview são 100% reutilizáveis.

## Achados (limites reais do piloto)

1. **Ids de elemento não são estáveis entre sessões de parse.** O engine atribui
   `sp_*` via contador de processo (`uidCounter`); o MESMO deck reaberto num novo
   `openPptx` (ou mais tarde no mesmo processo) recebe ids diferentes. Dentro da
   sessão do app (deck em memória) isso não afeta nada; mas **audit trails que
   referenciam `elementId` valem apenas para a sessão que aplicou**. Para
   verificação cross-session, identifique por conteúdo/posição (o harness faz
   isso). Implicação para o produto: se o audit precisa de identidade durável,
   adotar um id estável derivado do OOXML (ex: o `id` do `<p:sp>`) — issue em
   aberto para o adapter real.
2. **Normalização de cor no re-parse**: `fillColor: "FFC000"` na op → parse lê
   `#FFC000`. O adapter de produto deve normalizar cores na entrada/saída
   (aceitar com ou sem `#`).

## Estimativa de custo cross-app (Docs + Slides + PDF)

| Peça                                     | Docs                    | Slides                         | PDF                   |
| ---------------------------------------- | ----------------------- | ------------------------------ | --------------------- |
| Adapter de ops (tipos + validação)       | já existe (block-patch) | **feito neste spike**          | ~1-2d                 |
| Preview semântico                        | diff de blocos (existe) | descriptor shape-level (feito) | página/raster → ~2-3d |
| Wiring trust UX (propose→preview→accept) | ~2-3d                   | ~2-3d                          | ~2-3d                 |
| Audit + rollback                         | ~1d                     | ~1d                            | ~1d                   |
| **Total**                                | **~4-6d**               | **~3-4d**                      | **~6-8d**             |

**Recomendação**: a promessa cross-app pode ser feita publicamente. Ordem de
execução sugerida: **Slides primeiro** (adapter já validado → vira o template),
depois Docs (maioria das peças existe), PDF por último (preview é o gargalo).

## Como rodar

```bash
node ../../node_modules/.bin/tsx harness.mjs ../../templates/deck-base.pptx
# audit em ~/.hermesoffice-spike40-audit/spike-40/proposals/
```
