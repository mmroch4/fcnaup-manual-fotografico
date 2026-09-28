# Manual Fotográfico IAN-AF — versão pesquisável

Site estático (HTML, CSS e JS, sem dependências) para pesquisar o *Manual Fotográfico de
Quantificação de Alimentos IAN-AF 2015-2016* pelo nome do alimento e ver as fotografias com
os pesos, a composição nutricional e as medidas caseiras.

Criado por [Miguel Rocha](https://miguelrocha.dev).

## Estrutura

```
site/            ← é esta pasta que se publica
  index.html
  style.css
  app.js         pesquisa, calculadora, favoritos, navegação
  data.js        dados extraídos do PDF (gerado)
  img/           fotografias em WebP (geradas)
tools/extract.py extrai fotos e tabelas do PDF para site/
```

## Ver localmente

```bash
cd site
python3 -m http.server 8000
# abrir http://localhost:8000
```

(Abrir o `index.html` diretamente também funciona, porque os dados são carregados como script.)

## Publicar

### Vercel (recomendado)

O `vercel.json` já configura o projeto como site estático servido a partir de `site/`
(sem comando de build). Basta importar o repositório em [vercel.com/new](https://vercel.com/new)
e carregar em **Deploy** — cada `git push` para `main` gera um novo deploy.

Pela linha de comandos: `npx vercel` (pré-visualização) e `npx vercel --prod` (produção).

### Outros serviços

A pasta `site/` pode ser publicada tal como está em qualquer servidor de ficheiros estáticos
(~19 MB, quase tudo fotografias).

> O manual indica que as imagens não podem ser publicadas sem autorização prévia dos autores
> (geral@ian-af.up.pt). Obtenha essa autorização antes de pôr o site online.

## Regenerar os dados a partir do PDF

Requer `pdftotext` (poppler-utils) e Python com `pymupdf` e `pillow`:

```bash
python3 -m venv .venv && .venv/bin/pip install pymupdf pillow
.venv/bin/python tools/extract.py
```

O script localiza cada série pelo código no título da página (o índice do PDF tem alguns
números de página errados), associa cada foto à etiqueta `MQAxxx-A…H` por posição e lê as
Tabelas 1–4. No fim, lista as séries em que o número de fotos difere do número de linhas
nas tabelas (no manual original só acontece com MQA108 Chop suey).

## Funcionalidades

- Pesquisa por nome ou código, sem distinção de acentos e tolerante a pequenos erros de escrita
- Filtro por categoria (as 7 secções do manual) e botão **+** em cada linha para adicionar à refeição
- Fotografias A–H com ampliação (deslizar para mudar de foto no telemóvel)
- Porção consumida **por fotografia** (foto × ¼, ½, ¾, 1, 1½, 2, 3 ou outro valor) ou **em gramas**
- Energia, distribuição energética (proteína/hidratos/gordura), peso total, peso edível e composição nutricional
- **Montar refeição**: somar alimentos, ajustar foto/quantidade de cada um, ver totais, guardar refeições, copiar um resumo em texto e anular remoções
- Medidas caseiras com calculadora de volume
- Favoritos, refeições e vistos recentemente (guardados no navegador)
- Aviso sobre o objetivo do site (ajudar os estudantes da FCNAUP a utilizar o manual)
- Notas nas séries em que os valores do manual parecem ter gralhas (os valores são mantidos como no original)

## Referências de design

A interface segue padrões de apps de nutrição recolhidos no Mobbin: lista de resultados com
adição rápida (Cal AI, Lifesum, Yazio), resumo de macros com barra (BitePal, Alma), porção com
controlo segmentado e stepper (Cal AI, Bevel), botão de adicionar fixo e snackbar de confirmação
(Yazio, Garmin), criação de refeição (Noom, Yazio) e barra de navegação inferior no telemóvel.

## Licença

O **código** deste repositório (`site/index.html`, `site/style.css`, `site/app.js` e
`tools/extract.py`) está disponível sob a [licença MIT](LICENSE): pode ser usado, copiado,
modificado e distribuído livremente, incluindo para fins comerciais, desde que se mantenha o
aviso de copyright.

A licença MIT **não abrange** o conteúdo do manual: as fotografias (`site/img/`), os dados
extraídos (`site/data.js`) e o PDF original pertencem aos autores do *Manual Fotográfico de
Quantificação de Alimentos IAN-AF 2015-2016* (Universidade do Porto). A sua reprodução ou
publicação requer autorização prévia dos autores (geral@ian-af.up.pt).
