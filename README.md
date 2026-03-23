# ChEBI MCP Server

Model Context Protocol (MCP) server for ChEBI (Chemical Entities of Biological Interest) — chemical classification, ontology, and biological role annotation via the EBI OLS4 API.

## Features

- **Single unified tool** (`chebi_data`) with 5 methods
- No API key required — uses the public EBI OLS4 API
- Search chemical entities by name or keyword
- Full ontology navigation (parents, children)
- Compound classification with biological and pharmaceutical roles

## Installation

```bash
cd chebi-mcp-server
npm install
npm run build
```

## Usage

```json
{
  "mcpServers": {
    "chebi": {
      "command": "node",
      "args": ["/path/to/chebi-mcp-server/build/index.js"]
    }
  }
}
```

## Tool: chebi_data

Single unified tool with multiple methods accessed via the `method` parameter.

### Methods

#### 1. search_entity

Search ChEBI entities by name or keyword.

```json
{
  "method": "search_entity",
  "query": "aspirin",
  "limit": 5
}
```

Returns: ChEBI ID, label, description, OBO ID.

#### 2. get_entity

Get full details for a ChEBI entity.

```json
{
  "method": "get_entity",
  "chebi_id": "CHEBI:15365"
}
```

Returns: label, description, synonyms, is_a relations, annotations. Accepts `CHEBI:15365`, `CHEBI_15365`, or just `15365`.

#### 3. get_children

Get child terms in the ChEBI ontology hierarchy.

```json
{
  "method": "get_children",
  "chebi_id": "CHEBI:35222",
  "limit": 10
}
```

Returns: child term IDs and labels.

#### 4. get_parents

Get parent terms (is_a hierarchy).

```json
{
  "method": "get_parents",
  "chebi_id": "CHEBI:15365",
  "limit": 10
}
```

Returns: parent term IDs and labels (biological role, chemical role, etc.).

#### 5. classify_compound

Get the full classification and roles of a compound by name.

```json
{
  "method": "classify_compound",
  "query": "ibuprofen"
}
```

Returns: compound name, ChEBI ID, pharmaceutical roles, biological roles, chemical classification.

## Data Source

- **Database**: ChEBI (EMBL-EBI)
- **API**: https://www.ebi.ac.uk/ols4/api (Ontology Lookup Service)
- **Entities**: 60,000+ chemical entities with biological annotations
- **Rate limits**: No hard limits

## License

MIT
