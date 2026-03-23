#!/usr/bin/env node

/**
 * ChEBI MCP Server
 * Single-tool server providing access to ChEBI (Chemical Entities of Biological Interest)
 * via the EBI OLS4 (Ontology Lookup Service) REST API.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosError } from 'axios';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txt(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(msg: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    isError: true as const,
  };
}

/** Normalize ChEBI ID input: "CHEBI:15365", "15365", "CHEBI_15365" all become "15365" */
function normalizeChebiId(raw: string): string {
  return raw.replace(/^CHEBI[_:]/, '');
}

/** Double-encoded IRI for OLS4 path parameters */
function encodedIri(numericId: string): string {
  // http://purl.obolibrary.org/obo/CHEBI_15365
  // double URL-encoded: http%253A%252F%252Fpurl.obolibrary.org%252Fobo%252FCHEBI_15365
  const iri = `http://purl.obolibrary.org/obo/CHEBI_${numericId}`;
  return encodeURIComponent(encodeURIComponent(iri));
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const BASE_URL = 'https://www.ebi.ac.uk/ols4/api';

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'ChEBI-MCP-Server/1.0.0',
  },
});

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function searchEntity(args: Record<string, unknown>) {
  const query = args.query as string | undefined;
  if (!query) return err('query is required');

  const limit = (args.limit as number) || 10;

  const res = await api.get('/search', {
    params: { q: query, ontology: 'chebi', rows: limit },
  });

  const docs = res.data?.response?.docs ?? [];
  const results = docs.map((d: Record<string, unknown>) => ({
    id: d.obo_id,
    label: d.label,
    description: Array.isArray(d.description) ? d.description[0] : d.description,
    obo_id: d.obo_id,
    iri: d.iri,
  }));

  return txt({
    query,
    total: res.data?.response?.numFound ?? 0,
    returned: results.length,
    results,
  });
}

async function getEntity(args: Record<string, unknown>) {
  const chebiId = args.chebi_id as string | undefined;
  if (!chebiId) return err('chebi_id is required');

  const numId = normalizeChebiId(chebiId);
  const iri = `http://purl.obolibrary.org/obo/CHEBI_${numId}`;

  const res = await api.get('/ontologies/chebi/terms', {
    params: { iri },
  });

  const terms = res.data?._embedded?.terms ?? [];
  if (terms.length === 0) return err(`No entity found for CHEBI:${numId}`);

  const term = terms[0];
  return txt({
    chebi_id: `CHEBI:${numId}`,
    label: term.label,
    description: Array.isArray(term.description) ? term.description : [term.description].filter(Boolean),
    synonyms: term.synonyms ?? [],
    is_a: term.is_a ?? [],
    iri: term.iri,
    obo_id: term.obo_id,
    annotation: term.annotation ?? {},
  });
}

async function getChildren(args: Record<string, unknown>) {
  const chebiId = args.chebi_id as string | undefined;
  if (!chebiId) return err('chebi_id is required');

  const numId = normalizeChebiId(chebiId);
  const limit = (args.limit as number) || 20;
  const encoded = encodedIri(numId);

  const res = await api.get(`/ontologies/chebi/terms/${encoded}/children`, {
    params: { size: limit },
  });

  const terms = res.data?._embedded?.terms ?? [];
  const children = terms.map((t: Record<string, unknown>) => ({
    id: t.obo_id,
    label: t.label,
    description: Array.isArray(t.description) ? t.description[0] : t.description,
    iri: t.iri,
  }));

  return txt({
    parent: `CHEBI:${numId}`,
    total_children: res.data?.page?.totalElements ?? children.length,
    returned: children.length,
    children,
  });
}

async function getParents(args: Record<string, unknown>) {
  const chebiId = args.chebi_id as string | undefined;
  if (!chebiId) return err('chebi_id is required');

  const numId = normalizeChebiId(chebiId);
  const limit = (args.limit as number) || 20;
  const encoded = encodedIri(numId);

  const res = await api.get(`/ontologies/chebi/terms/${encoded}/parents`, {
    params: { size: limit },
  });

  const terms = res.data?._embedded?.terms ?? [];
  const parents = terms.map((t: Record<string, unknown>) => ({
    id: t.obo_id,
    label: t.label,
    description: Array.isArray(t.description) ? t.description[0] : t.description,
    iri: t.iri,
  }));

  return txt({
    child: `CHEBI:${numId}`,
    total_parents: res.data?.page?.totalElements ?? parents.length,
    returned: parents.length,
    parents,
  });
}

async function classifyCompound(args: Record<string, unknown>) {
  const query = args.query as string | undefined;
  if (!query) return err('query is required');

  // Step 1: search for the compound
  const searchRes = await api.get('/search', {
    params: { q: query, ontology: 'chebi', rows: 1 },
  });

  const docs = searchRes.data?.response?.docs ?? [];
  if (docs.length === 0) return err(`No ChEBI entity found for "${query}"`);

  const doc = docs[0];
  const oboId = doc.obo_id as string;
  const numId = normalizeChebiId(oboId);

  // Step 2: get full entity details
  const iri = `http://purl.obolibrary.org/obo/CHEBI_${numId}`;
  const termRes = await api.get('/ontologies/chebi/terms', {
    params: { iri },
  });

  const terms = termRes.data?._embedded?.terms ?? [];
  const term = terms[0] ?? {};

  // Step 3: get parents to find roles and classifications
  const encoded = encodedIri(numId);
  let parents: Array<Record<string, unknown>> = [];
  try {
    const parentsRes = await api.get(`/ontologies/chebi/terms/${encoded}/parents`, {
      params: { size: 50 },
    });
    parents = parentsRes.data?._embedded?.terms ?? [];
  } catch {
    // parents may not be available for all entities
  }

  const roles = parents.filter((p: Record<string, unknown>) => {
    const label = (p.label as string) || '';
    return label.includes('role') || label.includes('agent') || label.includes('inhibitor') ||
           label.includes('agonist') || label.includes('antagonist');
  });

  const classifications = parents.filter((p: Record<string, unknown>) => {
    const label = (p.label as string) || '';
    return !label.includes('role') && !label.includes('agent');
  });

  return txt({
    query,
    chebi_id: `CHEBI:${numId}`,
    label: term.label,
    description: Array.isArray(term.description) ? term.description[0] : term.description,
    synonyms: term.synonyms ?? [],
    roles: roles.map((r: Record<string, unknown>) => ({
      id: r.obo_id,
      label: r.label,
    })),
    chemical_classification: classifications.map((c: Record<string, unknown>) => ({
      id: c.obo_id,
      label: c.label,
    })),
    annotation: term.annotation ?? {},
  });
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const METHODS = [
  'search_entity',
  'get_entity',
  'get_children',
  'get_parents',
  'classify_compound',
] as const;

const server = new Server(
  { name: 'chebi-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'chebi_data',
      description:
        'Query ChEBI (Chemical Entities of Biological Interest) for chemical entity information, ontology hierarchy, roles, and classifications via the EBI OLS4 API. Choose a method and supply its parameters.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          method: {
            type: 'string',
            enum: METHODS as unknown as string[],
            description: [
              'search_entity - Search ChEBI entities by name/keyword',
              'get_entity - Get full details for a ChEBI entity by ID',
              'get_children - Get child entities in the ChEBI ontology',
              'get_parents - Get parent entities (is_a hierarchy)',
              'classify_compound - Get roles and classification of a compound by name',
            ].join('\n'),
          },
          query: {
            type: 'string',
            description:
              'Search query string. For search_entity (keyword search) and classify_compound (drug/compound name, e.g., "aspirin").',
          },
          chebi_id: {
            type: 'string',
            description:
              'ChEBI identifier (e.g., "CHEBI:15365", "15365", or "CHEBI_15365"). For get_entity, get_children, get_parents.',
          },
          limit: {
            type: 'number',
            description:
              'Max results to return (default: 10 for search_entity, 20 for get_children/get_parents).',
          },
        },
        required: ['method'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'chebi_data') {
    return err(`Unknown tool: ${request.params.name}`);
  }

  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const method = args.method as string;

  try {
    switch (method) {
      case 'search_entity':
        return await searchEntity(args);
      case 'get_entity':
        return await getEntity(args);
      case 'get_children':
        return await getChildren(args);
      case 'get_parents':
        return await getParents(args);
      case 'classify_compound':
        return await classifyCompound(args);
      default:
        return err(`Unknown method: ${method}. Valid: ${METHODS.join(', ')}`);
    }
  } catch (e: unknown) {
    const axErr = e as AxiosError;
    if (axErr.response) {
      return err(
        `OLS4 API ${axErr.response.status}: ${axErr.response.statusText}`,
      );
    }
    if (axErr.code === 'ECONNREFUSED' || axErr.code === 'ENOTFOUND' || axErr.code === 'ETIMEDOUT') {
      return err(
        `OLS4 API is unreachable (${axErr.code}). Please try again later.`,
      );
    }
    return err(e instanceof Error ? e.message : String(e));
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ChEBI MCP Server running on stdio');
}

main().catch((e) => {
  console.error('Server error:', e);
  process.exit(1);
});
