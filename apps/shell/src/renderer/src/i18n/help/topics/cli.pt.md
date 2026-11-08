# Linha de comandos e agentes

Todas as instalações incluem um comando `hermesoffice` que conduz os mesmos motores que a janela usa — os mesmos analisadores, o mesmo escritor, o mesmo renderizador. Um arquivo que o aplicativo salva e um arquivo que o comando escreve são o mesmo arquivo, e uma verificação que o painel de IA do aplicativo ultrapassa é uma verificação que o comando também ultrapassa.

```sh
hermesoffice --help          # every command
hermesoffice guide slides    # the op reference, for writing your own
```

É essa a superfície completa em uma única tela — cada comando com uma linha a dizer o que faz, depois as opções globais e os códigos de saída:

![A saída real de hermesoffice --help: a faixa de versão, cada comando com uma descrição de uma linha, e as opções globais e os códigos de saída](img/cli.png)

## Obter o comando

macOS e Windows o trazem dentro do pacote do app. Para chamá-lo pelo nome, rode uma vez `hermesoffice install-cli`: ele liga o binário do pacote em um diretório do seu PATH — no macOS `/usr/local/bin` quando não for um prefixo do Homebrew (os diretórios do Homebrew nunca são tocados), senão o seu bin de usuário — ou no seu `PATH` de usuário no Windows.

## Os comandos que vale a pena conhecer

| Comando           | O que faz                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open`            | Abre um documento no aplicativo; inicia o aplicativo se ele não estiver em execução.                                                                                                                                                                                                             |
| `selection`       | O que o usuário tem selecionado nesse arquivo neste momento, enquanto o aplicativo está em execução — o ponteiro para «este» / «aqui». Devolve um intervalo de blocos, um intervalo de células em uma planilha, elementos de um slide ou uma página, conforme o editor em que o arquivo estiver. |
| `convert`         | Converte entre formatos usando os motores do próprio aplicativo.                                                                                                                                                                                                                                 |
| `create`          | Cria um documento a partir de conteúdo estruturado.                                                                                                                                                                                                                                              |
| `render`          | Um PNG por página, tal como o renderizador o dispõe.                                                                                                                                                                                                                                             |
| `pdf`             | Lê a camada de texto de um PDF página a página, sem qualquer processo do aplicativo.                                                                                                                                                                                                             |
| `info`            | Metadados e um resumo da estrutura de um documento.                                                                                                                                                                                                                                              |
| `search`          | Pesquisa na web ou em imagens através do fornecedor configurado no aplicativo.                                                                                                                                                                                                                   |
| `image` / `media` | Gera uma imagem, ou descreve e faz perguntas sobre um arquivo de imagem, vídeo ou áudio.                                                                                                                                                                                                         |
| `merge`           | Preenche os marcadores `{{key}}` em um modelo `.docx`, `.pptx` ou `.xlsx`.                                                                                                                                                                                                                       |
| `capabilities`    | Indica que funcionalidades na nuvem estão configuradas nesta máquina.                                                                                                                                                                                                                            |
| `guide`           | A referência de operações e os guias de design, gerados a partir das mesmas definições contra as quais o executor valida — por isso não pode divergir do que `apply` aceita. `--json` devolve-a com o esquema de cada operação.                                                                  |
| `install-cli`     | Coloca o `hermesoffice` no `PATH`.                                                                                                                                                                                                                                                               |
| `skill`           | Lista os agentes de programação encontrados nesta máquina e instala ou atualiza neles a competência do HermesOffice.                                                                                                                                                                             |
| `mcp`             | Serve cada comando como uma ferramenta do Model Context Protocol. Consulte **Ligar um agente de programação**.                                                                                                                                                                                   |

## Edição: documentos, planilhas, apresentações

`hermesoffice docs`, `hermesoffice sheet` e `hermesoffice slides` leem e editam pelo mesmo caminho de escrita que o aplicativo usa, e compartilham um vocabulário: uma **operação** (op) é uma única edição, e uma **especificação** (spec) é uma lista de operações aplicadas por ordem.

```sh
hermesoffice sheet read report.xlsx
hermesoffice slides apply deck.pptx --ops ops.json --dry-run
hermesoffice docs apply brief.docx --ops ops.json
```

`--dry-run` relata o que um lote faria e não escreve nada, que é a forma barata de verificar uma especificação antes de a aplicar. O painel de IA do aplicativo funciona exatamente com estas operações, por isso tudo o que lhe pedir também pode ser escrito em script.

## Model Context Protocol

`hermesoffice mcp` serve cada comando como uma ferramenta MCP, e `hermesoffice mcp install <agent|all>` registra-a na configuração do próprio agente de programação. Consulte **Ligar um agente de programação** para esse lado.

## O que o comando não faz

Ele lê e escreve o arquivo. Não é o aplicativo: não há janela, e a janela de atualização do aplicativo não se aplica. Tudo o que precisa da janela — o painel de IA, a verificação de qualidade de uma apresentação renderizada — tem de esperar que abra o arquivo. `hermesoffice render` dá-lhe os pixels sem ela, e `hermesoffice slides` audita a disposição de uma apresentação por si só.
