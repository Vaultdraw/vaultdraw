I've built a one-page networking primer: the layers, addresses, the path a packet takes, and what happens when you open a website. Once you've kept it, I can go deeper on any section (subnets, DNS, TLS, routing) or add three quiz questions.

```vd heading level=1
Networking: how computers talk to each other
```

```vd text
A network is computers sending small messages to each other by agreed rules.
Every page, call and game you use depends on it.
```

```vd heading level=2
1. The layers: one job each
```

```vd text
- Application: the language apps speak (HTTP for web, SMTP for mail).
- Transport: gets data to the right program using ports (TCP or UDP).
- Internet: IP addresses and routing between networks.
- Link: one hop to the next neighbour (Wi-Fi, Ethernet).
- Each layer wraps the data from the layer above with its own header.
```

```vd diagram title="The four layers of networking" caption="Data goes down the layers on the sender and back up on the receiver."
flowchart TB
  A["4. Application: HTTP, DNS, SMTP"] -->|"1. message"| B["3. Transport: TCP or UDP, ports"]
  B -->|"2. segments"| C["2. Internet: IP addresses, routing"]
  C -->|"3. packets"| D["1. Link: Wi-Fi or Ethernet"]
  D -->|"4. frames"| E["Wire or radio signal"]
```

```vd heading level=2
2. Addresses and names
```

```vd text
- IP address: where a device is on the network (192.168.1.20, or IPv6).
- Port: which program on that device (443 = HTTPS, 80 = HTTP).
- MAC address: the hardware ID, used only inside your local network.
- DNS: the phone book that turns example.com into an IP address.
- Private IPs (192.168.x.x) are only valid at home; the router shares one public IP.
```

```vd heading level=2
3. The path of a packet
```

```vd text
- Your device sends the packet to the router (the default gateway).
- Each router reads the destination IP and picks the next hop.
- Packets of one message may take different routes and are reassembled.
- A router only knows the next step, not the whole route.
```

```vd diagram title="A packet crossing the internet" caption="Routers forward the packet hop by hop until it reaches the server."
flowchart LR
  A["Your laptop"] -->|"1. Wi-Fi"| B["Home router"]
  B -->|"2. to ISP"| C["ISP network"]
  C -->|"3. many hops"| D["Internet routers"]
  D -->|"4. last hop"| E["Web server"]
```

```vd heading level=2
4. TCP and UDP
```

```vd text
- TCP: reliable. Connects first, numbers packets, resends lost ones. Used for web, mail, files.
- UDP: fast. No connection, no resend. Used for video calls, games, DNS.
- Choose TCP when every byte must arrive, UDP when speed matters more.
```

```vd heading level=2
5. What happens when you open a website
```

```vd diagram title="Loading https://example.com" caption="Look up the address, open a TCP connection, then ask for the page."
sequenceDiagram
  autonumber
  participant B as Browser
  participant D as DNS resolver
  participant S as Web server
  B->>D: What is the IP of example.com?
  D-->>B: 93.184.216.34
  B->>S: SYN (let's connect)
  S-->>B: SYN-ACK (ok, ready)
  B->>S: ACK (connected)
  Note over B,S: TCP handshake done. TLS now encrypts the connection.
  B->>S: GET /index.html (over HTTPS)
  S-->>B: 200 OK with the page
```

```vd note
Example: sending a letter.
The IP address is the street address, the port is the flat number, DNS is looking up a name in the phone book, and routers are post offices passing the letter along. TCP is registered mail with a receipt; UDP is a postcard.
```

```vd note
Key terms
- Packet: a small piece of a message, with an address on it.
- Router: a device that forwards packets between networks.
- Protocol: an agreed set of rules for talking (HTTP, TCP, IP).
- DNS: turns names into IP addresses.
- Port: a number that picks the program on a device.
- Handshake: the first exchange that opens a TCP connection.
- Latency: how long a packet takes to arrive. Bandwidth: how much fits per second.
```

```vd text
Summary
- Networks work in layers, each with one job.
- IP addresses find the device, ports find the program, DNS finds the name.
- Routers pass packets hop by hop; TCP makes it reliable, UDP makes it fast.
```
