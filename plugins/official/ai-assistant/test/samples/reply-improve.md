I rebuilt it as a numbered sequence diagram, because this is a series of steps between parties.
- Every arrow now says what it carries (credentials, signed JWT, query).
- I added the missing steps: the password check, the token verification and the response.
- A note explains what a JWT holds, and a second note shows that the database is only queried after the token is verified.

```vd diagram title="JWT login: log in once, then call the API with a token" caption="The API trusts the token's signature, so it doesn't need the password again." replace=all
sequenceDiagram
  autonumber
  actor U as User
  participant L as Login service
  participant A as API
  participant D as Database
  U->>L: POST /login (username, password)
  L->>D: Look up user and password hash
  D-->>L: Stored hash
  L->>L: Compare password with hash
  L-->>U: Signed JWT (header.payload.signature)
  Note over U,L: The JWT holds who you are (sub) and when it expires (exp)
  U->>A: GET /orders with "Authorization: Bearer JWT"
  A->>A: Verify signature and check exp
  Note over A,D: Only a valid token reaches the database
  A->>D: Query orders for the user in sub
  D-->>A: Order rows
  A-->>U: 200 OK with the orders
```

```vd note
Key terms
- JWT: a signed token that proves who you are, without a server-side session.
- Signature: lets the API detect a forged or altered token.
- Bearer: whoever holds the token is let in, so keep it secret and short-lived.
```
