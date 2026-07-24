# Correção definitiva — Google Sheets e Google Sites

Versão: 1.3.0

## Planilha definida no projeto

O backend foi fixado para gravar exclusivamente nesta planilha:

- ID: `1IQmDzRaH0d76dzadJQ9NHfcomqrVQEG5v80FkaCQ4aA`
- URL: `https://docs.google.com/spreadsheets/d/1IQmDzRaH0d76dzadJQ9NHfcomqrVQEG5v80FkaCQ4aA/edit`
- Aba: `Cálculos de Carbono`

O ID escrito no código tem prioridade sobre propriedades antigas do Apps Script.

## Etapa 1 — Atualizar o Apps Script

1. Abra a planilha indicada acima.
2. Acesse **Extensões > Apps Script**.
3. Substitua integralmente o conteúdo do `Code.gs` pelo arquivo da pasta `google-apps-script`.
4. Substitua também o `appsscript.json`.
5. Salve.
6. Selecione a função `prepararPlanilha` e clique em **Executar**.
7. Autorize o acesso solicitado.
8. Selecione `testarGravacaoNaPlanilha` e clique em **Executar**.
9. Volte à planilha e confirme que surgiu uma linha com o nome **Teste de integração**.

Se essa linha não aparecer, consulte **Execuções** no Apps Script e abra o erro apresentado.

## Etapa 2 — Publicar uma nova versão do Apps Script

1. Clique em **Implantar > Gerenciar implantações**.
2. Clique no ícone de editar da implantação atual.
3. Em **Versão**, escolha **Nova versão**.
4. Confirme:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.
5. Clique em **Implantar**.
6. Copie novamente a URL terminada em `/exec`.
7. Mantenha essa URL em `APPS_SCRIPT_ENDPOINT` no Cloud Run.

## Etapa 3 — Conferir o Apps Script diretamente

Abra:

```text
SUA_URL_DO_APPS_SCRIPT/exec?action=health
```

A resposta precisa conter:

```json
{
  "success": true,
  "spreadsheetReady": true,
  "spreadsheetId": "1IQmDzRaH0d76dzadJQ9NHfcomqrVQEG5v80FkaCQ4aA",
  "sheetName": "Cálculos de Carbono",
  "modelVersion": "1.3.0"
}
```

Se o ID for diferente, a implantação executada ainda é antiga.

## Etapa 4 — Atualizar o GitHub e o Cloud Run

Envie todos os arquivos desta versão para a raiz do repositório:

```bash
git add .
git commit -m "Corrige planilha e incorporação no Google Sites v1.3.0"
git push origin main
```

Depois, no Cloud Run:

1. Abra o serviço `calculadora`.
2. Confira o histórico de builds e aguarde o novo build finalizar.
3. Abra **Revisões**.
4. Direcione **100% do tráfego** para a revisão criada pelo commit da versão 1.3.0.

## Etapa 5 — Confirmar a versão ativa do Cloud Run

Abra:

```text
https://calculadora-712003446287.europe-west1.run.app/api/version
```

O resultado deve mostrar:

```json
{
  "success": true,
  "appVersion": "1.3.0",
  "googleSitesEmbeddingEnabled": true
}
```

Depois abra:

```text
https://calculadora-712003446287.europe-west1.run.app/api/backend-health
```

Confirme que aparecem o ID correto da planilha e `modelVersion: 1.3.0`.

## Etapa 6 — Eliminar a versão antiga armazenada no navegador

A versão antiga pode permanecer no Service Worker.

1. Abra a calculadora no Chrome.
2. Pressione `F12`.
3. Abra **Application > Service Workers**.
4. Clique em **Unregister**.
5. Abra **Storage** e clique em **Clear site data**.
6. Feche e abra novamente:

```text
https://calculadora-712003446287.europe-west1.run.app/?v=1.3.0
```

No rodapé deve aparecer **Versão 1.3.0**. O formulário deve exigir nome e e-mail e informar que salva automaticamente.

## Etapa 7 — Incorporar no Google Sites

### Opção A — Por URL

No Google Sites:

1. **Inserir > Incorporar**.
2. Escolha **Por URL**.
3. Cole:

```text
https://calculadora-712003446287.europe-west1.run.app/?v=1.3.0
```

### Opção B — Por código de incorporação

Se a verificação “Por URL” continuar mostrando somente um link, escolha **Incorporar código** e use:

```html
<iframe
  src="https://calculadora-712003446287.europe-west1.run.app/?v=1.3.0"
  width="100%"
  height="1100"
  style="border:0; border-radius:12px;"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  title="Calculadora de redução de carbono AmazonBioEco">
</iframe>
```

Depois publique novamente o Google Sites.

## Cabeçalhos permitidos nesta versão

A versão 1.3.0 remove `X-Frame-Options` e permite incorporação pelas origens do Google Sites, Google e Googleusercontent por meio de `Content-Security-Policy: frame-ancestors`.
