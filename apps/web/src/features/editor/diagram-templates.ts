/**
 * Starter Mermaid templates for the architecture diagram types ForgeSpecs cares
 * about (system context / container / component / sequence / deployment / ERD).
 * Inserting one of these seeds a Mermaid block with valid, editable source so
 * authors get a working diagram instead of a blank canvas — the "diagram-type
 * ergonomics" M9 calls for. Mermaid rendering itself stays lazy (MermaidBlock).
 */
export interface DiagramTemplate {
  id: string;
  title: string;
  subtext: string;
  aliases: string[];
  code: string;
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: "context",
    title: "System context diagram",
    subtext: "C4 level 1 — the system and its users / external systems",
    aliases: ["context", "c4", "system", "landscape"],
    code: `flowchart TB
  user([User])
  system[["Your System"]]
  ext[(External Service)]
  user --> system
  system --> ext`,
  },
  {
    id: "container",
    title: "Container diagram",
    subtext: "C4 level 2 — apps, services, and data stores",
    aliases: ["container", "c4", "services"],
    code: `flowchart TB
  subgraph System
    web[Web App]
    api[API Service]
    db[(Database)]
  end
  web --> api --> db`,
  },
  {
    id: "component",
    title: "Component diagram",
    subtext: "C4 level 3 — components inside a container",
    aliases: ["component", "c4", "modules"],
    code: `flowchart LR
  controller[Controller] --> service[Service]
  service --> repo[Repository]
  repo --> db[(DB)]`,
  },
  {
    id: "sequence",
    title: "Sequence diagram",
    subtext: "Interactions over time between participants",
    aliases: ["sequence", "interaction", "flow"],
    code: `sequenceDiagram
  participant U as User
  participant A as API
  participant D as DB
  U->>A: Request
  A->>D: Query
  D-->>A: Rows
  A-->>U: Response`,
  },
  {
    id: "deployment",
    title: "Deployment diagram",
    subtext: "Infrastructure topology — nodes, regions, networks",
    aliases: ["deployment", "infra", "topology", "k8s"],
    code: `flowchart TB
  subgraph Cluster
    app[App Pod]
    collab[Collab Pod]
  end
  lb[Load Balancer] --> app
  app --> pg[(Postgres)]
  collab --> pg`,
  },
  {
    id: "erd",
    title: "Entity-relationship diagram",
    subtext: "Data model — entities and relationships",
    aliases: ["erd", "schema", "entity", "tables", "database"],
    code: `erDiagram
  USER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  USER {
    int id PK
    string email
  }
  ORDER {
    int id PK
    int user_id FK
  }`,
  },
];
