# Calculadora de Carbono AmazonBioEco — versão 1.2.0

Projeto completo para hospedar a calculadora no **Google Cloud Run**, salvar automaticamente no **Google Sheets** por meio do **Google Apps Script**, enviar o resultado por e-mail e manter uma fila offline no navegador.

## Alterações desta versão

- nome e e-mail obrigatórios;
- opção **Enviar uma cópia do resultado para o e-mail informado**;
- salvamento automático no dispositivo e no Google Sheets após cada cálculo;
- envio do e-mail pelo Google Apps Script;
- retentativa automática caso a internet ou o envio do e-mail falhe;
- preparação automática da aba `Cálculos de Carbono`;
- migração automática dos cabeçalhos da versão anterior;
- diagnóstico mais claro para URL incorreta, implantação privada, falta de vínculo com a planilha ou variável ausente no Cloud Run;
- Firebase App e Firebase Analytics preservados;
- PWA e funcionamento offline preservados.

> A calculadora apresenta uma estimativa educativa. Não substitui inventário de emissões, auditoria ambiental ou certificação de créditos de carbono.

---

# 1. Arquitetura

```text
Navegador / PWA
      │
      │ HTTPS
      ▼
Google Cloud Run
  ├─ hospeda a aplicação
  ├─ recebe POST /api/calculations
  └─ encaminha os dados ao Apps Script
      │
      ▼
Google Apps Script Web App
  ├─ prepara a aba automaticamente
  ├─ recalcula e valida os resultados
  ├─ grava no Google Sheets
  └─ envia o resultado por e-mail
      │
      ▼
Planilha Google
```

---

# 2. Estrutura

```text
AmazonBioEco_Calculadora_GoogleSheets_CloudRun/
├── Dockerfile
├── server.mjs
├── package.json
├── README.md
├── .dockerignore
├── .gitignore
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── config.js
│   ├── firebase.js
│   ├── api.js
│   ├── storage.js
│   ├── app.js
│   ├── service-worker.js
│   ├── manifest.webmanifest
│   ├── offline.html
│   └── icons/
└── google-apps-script/
    ├── Code.gs
    └── appsscript.json
```

---

# PARTE A — GOOGLE SHEETS E APPS SCRIPT

## 3. Criar ou abrir a Planilha Google

1. Abra a Planilha Google que receberá os cálculos.
2. Acesse:

```text
Extensões → Apps Script
```

É importante criar o Apps Script por esse menu para que ele fique vinculado à planilha.

## 4. Atualizar o Code.gs

1. No editor do Apps Script, abra `Code.gs`.
2. Apague o código antigo.
3. Copie integralmente:

```text
google-apps-script/Code.gs
```

4. Cole no editor.
5. Salve.

## 5. Atualizar o appsscript.json

O novo manifesto concede acesso à planilha e permissão para enviar e-mails.

1. No Apps Script, abra **Configurações do projeto**.
2. Ative **Mostrar o arquivo de manifesto appsscript.json no editor**.
3. Abra `appsscript.json`.
4. Substitua pelo conteúdo de:

```text
google-apps-script/appsscript.json
```

5. Salve.

As permissões usadas são:

```text
Google Sheets
Envio de e-mail pelo Apps Script
```

## 6. Preparar a planilha

A versão 1.2.0 prepara a planilha automaticamente no primeiro teste ou cálculo. Mesmo assim, recomenda-se executar a preparação uma vez para validar as permissões.

### Opção A — pelo editor

Selecione a função:

```javascript
prepararPlanilha
```

Clique em **Executar**, revise as permissões e autorize.

### Opção B — pela URL do Web App

Depois de publicar o Apps Script, abra:

```text
URL_DO_APPS_SCRIPT/exec?action=setup
```

O retorno esperado é semelhante a:

```json
{
  "success": true,
  "setupCompleted": true,
  "message": "Planilha preparada: Cálculos de Carbono | ID configurado: ..."
}
```

### Inicialização automática

Mesmo que `prepararPlanilha()` não tenha sido executada, o primeiro cálculo recebido:

- localiza a planilha vinculada;
- armazena seu ID nas propriedades do script;
- cria a aba `Cálculos de Carbono`;
- cria ou migra os cabeçalhos;
- aplica formatação e filtros.

Se o projeto do Apps Script não estiver vinculado a uma planilha, informe o ID em:

```javascript
SPREADSHEET_ID: ''
```

no início de `Code.gs`.

O ID é o trecho entre `/d/` e `/edit` na URL da planilha.

## 7. Implantar uma nova versão do Apps Script

Alterar o código não atualiza automaticamente a implantação já publicada.

1. Clique em **Implantar**.
2. Abra **Gerenciar implantações**.
3. Selecione a implantação existente e clique em **Editar**.
4. Em versão, selecione **Nova versão**.
5. Confirme:

```text
Executar como: Eu
Quem pode acessar: Qualquer pessoa
```

6. Clique em **Implantar**.
7. Autorize as novas permissões de envio de e-mail.
8. Copie a URL terminada em `/exec`.

Não use a URL terminada em `/dev`.

## 8. Testar o Apps Script

Abra:

```text
URL_DO_APPS_SCRIPT/exec?action=health
```

O retorno correto deve conter:

```json
{
  "success": true,
  "spreadsheetReady": true,
  "sheetName": "Cálculos de Carbono",
  "modelVersion": "1.2.0"
}
```

Se `spreadsheetReady` for `false`, leia o campo `message`; ele indicará se falta o vínculo ou o ID da planilha.

---

# PARTE B — GITHUB

## 9. Enviar a versão atualizada

Envie **todo o conteúdo da pasta do projeto** para a raiz do repositório GitHub.

```bash
git add .
git commit -m "Atualiza calculadora para salvamento automático e envio por email"
git push origin main
```

O `Dockerfile` deve permanecer na raiz:

```text
/Dockerfile
```

---

# PARTE C — GOOGLE CLOUD RUN

## 10. Conferir a integração contínua

No Cloud Run, a configuração do repositório deve usar:

```text
Tipo de build: Dockerfile
Local do Dockerfile: /Dockerfile
Diretório de contexto: /
Ramificação: main
Porta: 8080
Acesso: permitir invocações não autenticadas
```

O push para `main` deve iniciar um novo build e criar uma nova revisão.

## 11. Configurar APPS_SCRIPT_ENDPOINT

No serviço do Cloud Run:

1. Clique em **Editar e implantar nova revisão**.
2. Abra **Variáveis e secrets**.
3. Crie ou atualize:

```text
Nome: APPS_SCRIPT_ENDPOINT
Valor: https://script.google.com/macros/s/IDENTIFICADOR/exec
```

Regras importantes:

- use a URL `/exec` da implantação atual;
- não coloque aspas;
- não acrescente espaços;
- a implantação precisa permitir acesso a **Qualquer pessoa**.

4. Clique em **Implantar**.

## 12. Testar o Cloud Run

### Saúde do contêiner

Abra:

```text
URL_DO_CLOUD_RUN/healthz
```

Deve retornar:

```json
{
  "status": "ok",
  "googleSheetsBackendConfigured": true
}
```

### Diagnóstico da planilha

Abra:

```text
URL_DO_CLOUD_RUN/api/backend-health
```

Deve retornar `success: true` e `spreadsheetReady: true`.

Essa rota verifica toda a cadeia:

```text
Cloud Run → Apps Script → Google Sheets
```

## 13. Testar um cálculo

1. Abra a URL pública do Cloud Run.
2. Atualize forçadamente com `Ctrl + Shift + R`.
3. Informe nome e e-mail.
4. Mantenha marcada ou desmarque a opção de envio por e-mail.
5. Informe ao menos um valor ambiental.
6. Clique em **Calcular e salvar automaticamente**.
7. Confirme:
   - resultado exibido;
   - mensagem de gravação automática;
   - nova linha na aba `Cálculos de Carbono`;
   - e-mail recebido, quando solicitado.

---

# 14. Funcionamento offline

Ao calcular sem internet:

1. o resultado é calculado normalmente;
2. a operação é gravada em IndexedDB;
3. a interface informa que o registro está pendente;
4. ao retornar a conexão, a sincronização é iniciada automaticamente;
5. o registro é removido da fila somente depois da confirmação do Apps Script;
6. se a planilha foi salva, mas o e-mail falhou, a operação permanece na fila para nova tentativa de envio.

O UUID da operação impede a criação de linhas duplicadas.

---

# 15. Colunas da planilha

A aba utiliza 28 colunas:

1. Data e hora;
2. ID da operação;
3. Versão do modelo;
4. Nome;
5. E-mail;
6. Enviar resultado por e-mail;
7. Estado;
8. Município;
9. Papel;
10. Plástico;
11. Vidro;
12. Metal;
13. Compostagem;
14. Produtos agrícolas;
15. Práticas sustentáveis;
16. Reciclagem anual;
17. Compostagem anual;
18. Agricultura anual;
19. Redução total;
20. Percentual regional;
21. Árvores equivalentes;
22. Carros equivalentes;
23. Residências equivalentes;
24. Origem;
25. Navegador;
26. Status da planilha;
27. Status do e-mail;
28. Data do envio do e-mail.

Caso a aba ainda possua os cabeçalhos da versão anterior, o script migra os dados existentes pelo nome de cada coluna.

---

# 16. Diagnóstico de erros

## “A variável APPS_SCRIPT_ENDPOINT não está configurada”

Adicione a variável no Cloud Run e implante uma nova revisão.

## “O Apps Script retornou uma página HTML em vez de JSON”

Normalmente significa:

- URL `/dev` em vez de `/exec`;
- implantação exige login;
- acesso não está definido como **Qualquer pessoa**;
- URL de implantação antiga ou removida.

## “Planilha não vinculada”

Crie o Apps Script por:

```text
Planilha Google → Extensões → Apps Script
```

ou informe o ID em `CONFIG.SPREADSHEET_ID` no `Code.gs`.

## “Cálculo salvo, mas o e-mail não foi enviado”

Verifique:

- autorização do escopo de envio de e-mail;
- cota diária do Apps Script;
- endereço informado;
- spam ou lixo eletrônico.

O cálculo permanece salvo na planilha. A fila tentará novamente o envio do e-mail.

## A página ainda mostra o botão ou texto antigo

O Service Worker pode estar utilizando cache anterior.

1. Faça `Ctrl + Shift + R`.
2. Caso permaneça, abra as ferramentas do navegador.
3. Em **Application → Service Workers**, remova o registro.
4. Limpe os dados do site e reabra a aplicação.

---

# 17. Teste local

```bash
npm start
```

Sem a variável do Apps Script, a interface abrirá, mas o diagnóstico mostrará que o backend não está configurado.

Para testar com uma URL real:

```bash
APPS_SCRIPT_ENDPOINT="https://script.google.com/macros/s/IDENTIFICADOR/exec" npm start
```

No Windows PowerShell:

```powershell
$env:APPS_SCRIPT_ENDPOINT="https://script.google.com/macros/s/IDENTIFICADOR/exec"
npm start
```

Abra:

```text
http://localhost:8080
```


---

# 18. Incorporar no Google Sites

O servidor está configurado para permitir incorporação por `https://sites.google.com` usando a diretiva HTTP `Content-Security-Policy: frame-ancestors`.

Consulte o passo a passo em:

```text
GOOGLE_SITES.md
```

Para um Google Sites publicado em domínio próprio, configure no Cloud Run:

```text
ALLOWED_FRAME_ANCESTORS=https://www.seudominio.org.br
```

---

## Correção v1.3.0

Esta versão fixa a planilha de destino pelo ID `1IQmDzRaH0d76dzadJQ9NHfcomqrVQEG5v80FkaCQ4aA`, adiciona diagnóstico de versão e planilha e amplia a compatibilidade de incorporação no Google Sites. Consulte `CORRECAO_PLANILHA_GOOGLE_SITES.md`.
