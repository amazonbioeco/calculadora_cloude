# Calculadora de Carbono AmazonBioEco

Projeto completo para:

- hospedar a aplicação no **Google Cloud Run**;
- fazer implantação contínua a partir do **GitHub**;
- salvar os resultados em uma **Planilha Google** por meio do **Google Apps Script**;
- funcionar como **PWA**, inclusive com rascunho e fila offline;
- reutilizar o **Firebase App e Firebase Analytics** já configurados.

> A aplicação é uma estimativa educativa. Ela não substitui inventário de emissões, auditoria ambiental ou certificação de créditos de carbono.

---

## 1. Arquitetura final

```text
Usuário / navegador
        │
        │ HTTPS
        ▼
Google Cloud Run
  ├─ entrega HTML, CSS, JavaScript e PWA
  ├─ recebe POST em /api/calculations
  └─ encaminha a solicitação ao Apps Script
        │
        ▼
Google Apps Script Web App
        │
        ▼
Google Sheets — aba "Cálculos de Carbono"
```

O navegador não chama diretamente o Apps Script. O Cloud Run atua como proxy de mesma origem, evitando problemas de CORS e mantendo a URL do Apps Script fora do código público do frontend.

---

## 2. Estrutura do projeto

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

# PARTE A — CONFIGURAR O GOOGLE SHEETS

## 3. Criar a Planilha Google

1. Acesse o Google Drive.
2. Crie uma nova **Planilha Google**.
3. Dê um nome, por exemplo:

```text
Base de Dados — Calculadora de Carbono AmazonBioEco
```

4. Com a planilha aberta, acesse:

```text
Extensões → Apps Script
```

O Google recomenda esse caminho para criar um script vinculado à Planilha Google.

Referência oficial:
https://developers.google.com/apps-script/guides/sheets

---

## 4. Inserir o Code.gs

1. No editor do Apps Script, abra o arquivo `Code.gs`.
2. Apague o conteúdo existente.
3. Abra neste projeto:

```text
google-apps-script/Code.gs
```

4. Copie todo o conteúdo.
5. Cole no `Code.gs` do Apps Script.
6. Salve o projeto.

### Manifesto opcional

O projeto também contém:

```text
google-apps-script/appsscript.json
```

Para utilizá-lo:

1. Abra **Configurações do projeto** no Apps Script.
2. Ative a opção para mostrar o arquivo de manifesto `appsscript.json`.
3. Abra o arquivo exibido.
4. Substitua o conteúdo pelo manifesto fornecido.
5. Salve.

O manifesto define, entre outros parâmetros, o fuso horário da aplicação.

---

## 5. Preparar automaticamente a planilha

No seletor de funções do Apps Script, escolha:

```javascript
prepararPlanilha
```

Clique em **Executar**.

Na primeira execução, o Google solicitará autorização:

1. Clique em **Revisar permissões**.
2. Selecione sua Conta Google.
3. Autorize o acesso à planilha.

A função realizará automaticamente:

- gravação do ID da planilha nas propriedades do script;
- criação da aba `Cálculos de Carbono`;
- criação dos cabeçalhos;
- formatação das colunas;
- congelamento da primeira linha;
- aplicação de filtro;
- definição dos formatos numéricos e de data.

A execução deve retornar uma mensagem semelhante a:

```text
Planilha preparada: Cálculos de Carbono | ID configurado: ...
```

Não pule esta etapa. Quando o Apps Script é executado como Web App, não se deve depender da planilha ativa; por isso, o código armazena o `SPREADSHEET_ID` ao executar `prepararPlanilha()`.

---

## 6. Publicar o Apps Script como aplicativo da Web

No editor do Apps Script:

1. Clique em **Implantar**.
2. Clique em **Nova implantação**.
3. Em **Selecionar tipo**, escolha **Aplicativo da Web**.
4. Em descrição, informe, por exemplo:

```text
API da Calculadora de Carbono AmazonBioEco
```

5. Em **Executar como**, selecione:

```text
Eu
```

6. Em **Quem pode acessar**, selecione a opção pública disponível para sua conta, normalmente:

```text
Qualquer pessoa
```

7. Clique em **Implantar**.
8. Autorize novamente, caso seja solicitado.
9. Copie a URL terminada em `/exec`.

Exemplo de formato:

```text
https://script.google.com/macros/s/IDENTIFICADOR_DA_IMPLANTACAO/exec
```

Referência oficial:
https://developers.google.com/apps-script/guides/web

### Testar o Apps Script

Abra no navegador a URL copiada. Como a ação padrão é `health`, deverá aparecer uma resposta JSON semelhante a:

```json
{
  "success": true,
  "service": "AmazonBioEco Carbon Calculator API",
  "modelVersion": "1.1.0"
}
```

Guarde essa URL. Ela será usada como variável de ambiente no Cloud Run.

---

# PARTE B — ENVIAR O PROJETO AO GITHUB

## 7. Criar o repositório

1. Entre no GitHub.
2. Crie um novo repositório.
3. Use um nome como:

```text
amazonbioeco-calculadora-carbono
```

4. Envie **todo o conteúdo desta pasta** para a raiz do repositório.

O repositório deve mostrar o `Dockerfile` diretamente na raiz:

```text
/Dockerfile
```

Não envie somente a pasta `public`.

### Usando Git no terminal

Dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Projeto inicial da calculadora AmazonBioEco"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

Também é possível enviar os arquivos pela interface Web do GitHub.

---

# PARTE C — IMPLANTAR NO GOOGLE CLOUD RUN

## 8. Criar ou selecionar o projeto Google Cloud

1. Acesse o Console do Google Cloud.
2. Crie ou selecione um projeto.
3. Confirme que o faturamento está habilitado para o projeto, quando exigido.
4. Abra o serviço **Cloud Run**.

A implantação contínua do Cloud Run aceita repositórios com um `Dockerfile` e utiliza o Cloud Build para criar e implantar novas revisões.

Referências oficiais:

- https://docs.cloud.google.com/run/docs/continuous-deployment
- https://docs.cloud.google.com/run/docs/container-contract

---

## 9. Criar o serviço com implantação contínua do GitHub

No Cloud Run:

1. Clique em **Criar serviço**.
2. Escolha a opção equivalente a:

```text
Implantar continuamente novas revisões de um repositório de origem
```

3. Clique em **Configurar com Cloud Build**.
4. Conecte sua conta do GitHub, caso ainda não esteja conectada.
5. Autorize o aplicativo do Google Cloud no GitHub.
6. Selecione o repositório criado.
7. Selecione a ramificação:

```text
main
```

8. Na configuração de build, escolha:

```text
Tipo de build: Dockerfile
```

9. Informe:

```text
Local do Dockerfile: /Dockerfile
Diretório de contexto: /
```

Em algumas telas, o campo pode aparecer sem a barra inicial. Nesse caso, use:

```text
Dockerfile
```

O arquivo deve continuar localizado na raiz do repositório.

---

## 10. Configurar o serviço do Cloud Run

Utilize uma configuração semelhante a esta:

```text
Nome do serviço: amazonbioeco-calculadora-carbono
Região: escolha uma região adequada ao público do projeto
Porta do contêiner: 8080
Autenticação: permitir acesso público/não autenticado
```

O servidor já está configurado para escutar em `0.0.0.0` e usar automaticamente a variável `PORT` fornecida pelo Cloud Run. O padrão do serviço é a porta 8080.

Referência oficial:
https://docs.cloud.google.com/run/docs/container-contract

### Acesso público

Como a calculadora será divulgada ao público, selecione a opção equivalente a:

```text
Permitir invocações não autenticadas
```

Sem essa permissão, os visitantes receberão uma tela de autenticação ou erro de acesso.

---

## 11. Configurar a variável do Google Sheets

Antes de criar o serviço, abra a seção de configurações do contêiner, normalmente apresentada como:

```text
Contêineres, volumes, rede e segurança
```

Localize **Variáveis e secrets** ou **Variáveis de ambiente**.

Crie a seguinte variável:

```text
Nome: APPS_SCRIPT_ENDPOINT
Valor: URL_DO_APPS_SCRIPT_TERMINADA_EM_EXEC
```

Exemplo:

```text
APPS_SCRIPT_ENDPOINT=https://script.google.com/macros/s/IDENTIFICADOR/exec
```

Não coloque aspas no valor.

Essa variável é lida somente pelo servidor do Cloud Run. O endereço do Apps Script não precisa ser inserido no HTML ou no JavaScript público.

---

## 12. Implantar

1. Revise as configurações.
2. Clique em **Criar** ou **Implantar**.
3. Aguarde o Cloud Build criar a imagem a partir do `Dockerfile`.
4. Aguarde o Cloud Run publicar a primeira revisão.
5. Ao concluir, copie a URL do serviço.

O endereço terá formato semelhante a:

```text
https://amazonbioeco-calculadora-carbono-IDENTIFICADOR.REGIAO.run.app
```

Esse é o endereço principal que deverá ser divulgado.

---

# PARTE D — TESTAR A INSTALAÇÃO

## 13. Testar a saúde do Cloud Run

Acrescente `/healthz` à URL do Cloud Run:

```text
https://SEU_SERVICO.run.app/healthz
```

A resposta esperada é semelhante a:

```json
{
  "status": "ok",
  "service": "calculadora-carbono-amazonbioeco",
  "googleSheetsBackendConfigured": true
}
```

Se `googleSheetsBackendConfigured` aparecer como `false`, a variável `APPS_SCRIPT_ENDPOINT` não foi configurada corretamente.

---

## 14. Testar a gravação na planilha

1. Abra a URL principal do Cloud Run.
2. Preencha ao menos um valor de reciclagem, compostagem ou agricultura.
3. Clique em **Calcular impacto**.
4. Confira o resultado.
5. Clique em **Salvar resultado na planilha**.
6. Abra a Planilha Google.
7. Confira a nova linha na aba:

```text
Cálculos de Carbono
```

O Apps Script recalcula os resultados no servidor. Os valores calculados pelo navegador não são aceitos automaticamente como fonte final.

---

## 15. Testar o funcionamento offline

1. Abra a aplicação com internet pelo menos uma vez.
2. Aguarde o carregamento completo.
3. Desative a conexão do dispositivo ou use o modo offline das ferramentas do navegador.
4. Atualize a página.
5. Confirme que a interface continua disponível.
6. Faça um cálculo.
7. Clique para salvar.
8. Confirme a mensagem de que o resultado ficou armazenado no dispositivo.
9. Feche e reabra a aplicação.
10. Restabeleça a internet.
11. A aplicação tentará sincronizar automaticamente.
12. Também é possível usar o botão **Sincronizar agora**.

A fila offline é armazenada no IndexedDB do navegador e utiliza um UUID para impedir registros duplicados.

---

# PARTE E — FIREBASE

## 16. Firebase já incluído

O projeto reutiliza a configuração informada anteriormente para:

- Firebase App;
- Firebase Analytics.

Os arquivos envolvidos são:

```text
public/firebase.js
public/config.js
```

Para esta implantação, o **Firebase Hosting não é necessário**, porque a aplicação será hospedada no Cloud Run.

O Firebase é usado somente para Analytics. A gravação dos cálculos ocorre no Google Sheets por Apps Script.

A configuração pública do SDK do Firebase não é uma senha administrativa. Mesmo assim, nenhuma credencial privada, chave de conta de serviço ou token deve ser adicionada ao repositório.

---

# PARTE F — ATUALIZAÇÕES AUTOMÁTICAS

## 17. Publicar futuras alterações

Depois que a implantação contínua estiver configurada, toda alteração enviada à ramificação `main` poderá gerar automaticamente:

1. um novo build no Cloud Build;
2. uma nova imagem de contêiner;
3. uma nova revisão do Cloud Run;
4. a atualização do serviço público.

Fluxo normal:

```bash
git add .
git commit -m "Descrição da atualização"
git push origin main
```

Acompanhe o resultado em:

```text
Google Cloud Console → Cloud Build → Histórico
Google Cloud Console → Cloud Run → Revisões
```

Se alterar o `service-worker.js`, também atualize a constante `CACHE_VERSION` para que os dispositivos recebam os arquivos novos.

---

# PARTE G — TESTE LOCAL OPCIONAL

## 18. Executar com Node.js

É necessário Node.js 20 ou superior.

Na raiz do projeto:

```bash
npm start
```

Abra:

```text
http://localhost:8080
```

Sem a variável `APPS_SCRIPT_ENDPOINT`, a calculadora funcionará, mas o envio ficará na fila local.

Para testar a integração localmente em Linux ou macOS:

```bash
APPS_SCRIPT_ENDPOINT="https://script.google.com/macros/s/IDENTIFICADOR/exec" npm start
```

No PowerShell:

```powershell
$env:APPS_SCRIPT_ENDPOINT="https://script.google.com/macros/s/IDENTIFICADOR/exec"
npm start
```

---

## 19. Testar com Docker

Construir a imagem:

```bash
docker build -t amazonbioeco-calculadora-carbono .
```

Executar:

```bash
docker run --rm \
  -p 8080:8080 \
  -e PORT=8080 \
  -e APPS_SCRIPT_ENDPOINT="https://script.google.com/macros/s/IDENTIFICADOR/exec" \
  amazonbioeco-calculadora-carbono
```

No Windows PowerShell, o comando pode ser colocado em uma única linha.

---

# PARTE H — SOLUÇÃO DE PROBLEMAS

## 20. Cloud Run mostra erro ao iniciar

Verifique:

- se o `Dockerfile` está na raiz;
- se `server.mjs` existe na raiz;
- se a pasta `public` foi enviada ao GitHub;
- se o build selecionou `/Dockerfile`;
- se a aplicação está usando a porta 8080.

Consulte os logs em:

```text
Cloud Run → Serviço → Logs
```

---

## 21. A página abre, mas não salva na planilha

Confira:

1. se a URL do Apps Script termina em `/exec`;
2. se `APPS_SCRIPT_ENDPOINT` foi criada no Cloud Run;
3. se o Apps Script foi implantado como Web App;
4. se o acesso público foi permitido;
5. se `prepararPlanilha()` foi executada;
6. se a Conta Google proprietária do script possui acesso à planilha;
7. se `/healthz` mostra `googleSheetsBackendConfigured: true`;
8. os logs do Cloud Run;
9. as execuções no painel do Apps Script.

---

## 22. Alterei o Apps Script, mas nada mudou

Sempre que alterar `Code.gs`:

1. salve o projeto;
2. abra **Implantar → Gerenciar implantações**;
3. edite a implantação ativa;
4. selecione **Nova versão**;
5. implante novamente.

A URL `/exec` normalmente permanece a mesma quando a implantação existente é atualizada.

---

## 23. Há registros duplicados

A aplicação usa um UUID por operação e o Apps Script procura esse UUID antes de gravar. Não remova a coluna **ID da operação** nem altere manualmente os identificadores.

---

## 24. A PWA continua exibindo uma versão antiga

1. envie a versão nova ao GitHub;
2. confirme que o Cloud Build terminou com sucesso;
3. incremente `CACHE_VERSION` em `public/service-worker.js`;
4. feche e reabra a aplicação;
5. em último caso, limpe os dados do site ou desinstale e reinstale a PWA.

---

# PARTE I — SEGURANÇA E LIMITAÇÕES

## 25. Medidas implementadas

- servidor executado como usuário não administrativo no contêiner;
- validação de tipos e limites no frontend;
- validação e recálculo no Apps Script;
- sanitização de textos;
- limite de tamanho das requisições no Cloud Run;
- bloqueio concorrente no Apps Script;
- idempotência por UUID;
- fila offline persistente;
- endpoint do Apps Script armazenado em variável do Cloud Run;
- nenhum token privado no frontend;
- cabeçalhos HTTP de segurança;
- rota de saúde `/healthz`.

## 26. Limitações

- Apps Script e Google Sheets possuem cotas de uso;
- uma aplicação pública pode receber tráfego automatizado;
- a calculadora fornece estimativas educativas;
- Firebase Analytics depende de conexão e das configurações de privacidade do navegador;
- dados offline permanecem no dispositivo até serem sincronizados ou apagados pelo usuário/navegador;
- o acesso público ao Apps Script pode depender das políticas da organização Google Workspace.

---

# CHECKLIST FINAL

Use esta lista antes de divulgar:

- [ ] Planilha Google criada.
- [ ] `Code.gs` copiado.
- [ ] `prepararPlanilha()` executada e autorizada.
- [ ] Apps Script implantado como Web App.
- [ ] URL `/exec` testada.
- [ ] Projeto completo enviado ao GitHub.
- [ ] `Dockerfile` visível na raiz do repositório.
- [ ] Repositório conectado ao Cloud Run.
- [ ] Build configurado como Dockerfile.
- [ ] Caminho `/Dockerfile` e contexto `/` definidos.
- [ ] Serviço configurado para acesso público.
- [ ] Porta 8080 configurada.
- [ ] Variável `APPS_SCRIPT_ENDPOINT` definida.
- [ ] `/healthz` retorna status `ok` e backend configurado.
- [ ] Cálculo salvo na planilha.
- [ ] Funcionamento offline testado.
- [ ] URL do Cloud Run divulgada.

---

## Endereço para divulgação

Divulgue a URL HTTPS gerada pelo Cloud Run:

```text
https://SEU_SERVICO.REGIAO.run.app
```

Essa passa a ser a URL oficial da Calculadora de Carbono AmazonBioEco.
