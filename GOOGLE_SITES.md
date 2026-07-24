# Incorporar a calculadora no Google Sites

URL da aplicação:

```text
https://calculadora-712003446287.europe-west1.run.app/
```

## O que foi corrigido

O servidor enviava este cabeçalho:

```text
X-Frame-Options: SAMEORIGIN
```

Esse cabeçalho bloqueava a abertura da aplicação dentro do iframe do Google Sites. A versão atual remove esse bloqueio e envia:

```text
Content-Security-Policy: frame-ancestors 'self' https://sites.google.com;
```

Assim, a calculadora pode ser incorporada pelo próprio domínio e pelo Google Sites, sem liberar a incorporação para qualquer site.

## 1. Publicar a alteração no GitHub

Na pasta do projeto, execute:

```bash
git add server.mjs public/service-worker.js package.json GOOGLE_SITES.md
git commit -m "Permite incorporar a calculadora no Google Sites"
git push origin main
```

Se o Cloud Run estiver conectado ao GitHub, o Cloud Build criará uma nova revisão automaticamente.

## 2. Confirmar a nova revisão no Cloud Run

No Google Cloud Console:

1. Abra **Cloud Run**.
2. Selecione o serviço da calculadora.
3. Abra a guia **Revisões**.
4. Confirme que a nova revisão recebeu 100% do tráfego.
5. Confirme que o serviço permite invocações não autenticadas.

## 3. Verificar os cabeçalhos

No terminal, execute:

```bash
curl -I https://calculadora-712003446287.europe-west1.run.app/
```

A resposta deve conter:

```text
Content-Security-Policy: frame-ancestors 'self' https://sites.google.com;
```

E não deve conter:

```text
X-Frame-Options: SAMEORIGIN
X-Frame-Options: DENY
```

## 4. Incorporar no Google Sites

1. Abra o Google Sites em modo de edição.
2. Clique em **Inserir**.
3. Selecione **Incorporar**.
4. Escolha **Por URL**.
5. Cole:

```text
https://calculadora-712003446287.europe-west1.run.app/
```

6. Clique em **Inserir**.
7. Ajuste a altura e a largura do bloco.
8. Clique em **Publicar**.

Para uma experiência melhor em celulares, também é possível usar **Páginas → Adicionar → Incorporação de página inteira**.

## Google Sites com domínio personalizado

Se o Google Sites for publicado em um domínio próprio, adicione esse domínio à variável de ambiente do Cloud Run:

```text
ALLOWED_FRAME_ANCESTORS=https://www.seudominio.org.br
```

Para mais de um domínio, use vírgula:

```text
ALLOWED_FRAME_ANCESTORS=https://www.seudominio.org.br,https://portal.seudominio.org.br
```

Somente origens HTTPS válidas são aceitas.

## Limitações dentro do iframe

A calculadora funciona incorporada, incluindo cálculo e gravação no Google Sheets. Alguns recursos próprios de PWA, como o aviso de instalação do aplicativo, podem não aparecer dentro do iframe. Mantenha também um botão ou link para abrir a aplicação em uma nova guia.
