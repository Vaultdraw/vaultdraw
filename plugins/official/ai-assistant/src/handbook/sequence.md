---
when: \b(protocol|login|log ?in|auth\w*|oauth|jwt|token|request|response|api|http|tcp|handshake|dns|tls|ssl|network\w*|message|flow|steps|process|sequence|diagram|how .* works?)\b
---
## Worked example: a sequence diagram
Request: "how does JWT login work"
```vd diagram title="How JWT login works: log in once, then send the token" caption="The server checks the token's signature, not the password, on every request."
sequenceDiagram
  autonumber
  actor U as User
  participant C as App (browser)
  participant S as API server
  U->>C: Enter username and password
  C->>S: POST /login (credentials)
  S->>S: Check password against stored hash
  S-->>C: Signed JWT (header.payload.signature)
  Note over C,S: The JWT holds who you are (sub) and when it expires (exp)
  C->>S: GET /orders with "Authorization: Bearer JWT"
  S->>S: Verify signature, check exp
  S-->>C: 200 OK with the orders
```
A flowchart gets the same care: `A[Order placed] -->|payment ok| B[Pack the order]`.
