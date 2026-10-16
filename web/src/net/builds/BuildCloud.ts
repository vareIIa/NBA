// Cliente das builds compartilhadas (docs/23 §6): fala com /api/builds no mesmo servidor da sala (o Worker da
// Cloudflare em produção, server/dev.ts no desenvolvimento). Tudo é "melhor esforço" e com tempo limite: sem servidor,
// as funções devolvem null/false e o Meu Jogador segue com as builds deste navegador.
import { defaultServerUrl } from '../NetClient';
import { BuildsPath, OwnerHeader, type SharedBuild, ownerHash, validOwnerKey } from './BuildCatalog';
import type { PlayerBuild } from '../../build/PlayerBuild';

/** A chave do dono fica no localStorage: a build é do jogador (deste navegador), não da aba. */
const OwnerKeyStorage = 'garrafao.builds.dono';
const TimeoutMs = 5000;

/** Endereço da API a partir do endereço da sala: wss://host/ws → https://host/api/builds. null se não der. */
export function buildsApiUrl(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    else if (u.protocol === 'ws:') u.protocol = 'http:';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.pathname = u.pathname.replace(/\/ws\/?$/, '').replace(/\/$/, '') + BuildsPath;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function apiUrl(): string | null {
  try {
    return buildsApiUrl(defaultServerUrl());
  } catch {
    return null;
  }
}

function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

let memoryKey: string | null = null;
/** Chave do dono deste navegador (criada na primeira vez). */
export function ownerKey(): string {
  try {
    const saved = localStorage.getItem(OwnerKeyStorage);
    if (validOwnerKey(saved)) return saved;
    const key = randomKey();
    localStorage.setItem(OwnerKeyStorage, key);
    return key;
  } catch {
    // Sem armazenamento (aba privada): a chave vale só enquanto a página estiver aberta.
    return (memoryKey ??= randomKey());
  }
}

let myHash: Promise<string> | null = null;
/** Hash da chave deste navegador (o "owner" que o servidor devolve nas builds dele). */
export function myOwnerHash(): Promise<string> {
  return (myHash ??= ownerHash(ownerKey()));
}

async function request(url: string, init: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TimeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const BuildCloud = {
  /** Todas as builds do servidor, ou null sem conexão (ou resposta estranha). */
  async list(): Promise<SharedBuild[] | null> {
    const url = apiUrl();
    if (!url) return null;
    const res = await request(url, { method: 'GET' });
    if (!res?.ok) return null;
    try {
      const body = (await res.json()) as { builds?: unknown };
      return Array.isArray(body.builds) ? (body.builds as SharedBuild[]) : null;
    } catch {
      return null;
    }
  },

  /**
   * Sobe (cria ou atualiza) uma build deste navegador. 'ok' subiu; 'refused' o servidor recusou de vez (build de outro
   * dono, inválida, limite): não adianta repetir; 'offline' sem conexão ou erro passageiro: tentar de novo depois.
   */
  async push(build: PlayerBuild): Promise<'ok' | 'refused' | 'offline'> {
    const url = apiUrl();
    if (!url) return 'offline';
    const res = await request(`${url}/${encodeURIComponent(build.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [OwnerHeader]: ownerKey() },
      body: JSON.stringify(build),
    });
    if (!res) return 'offline';
    if (res.ok) return 'ok';
    return res.status === 429 || res.status >= 500 ? 'offline' : 'refused';
  },

  /** Exclui uma build deste navegador no servidor. false = tentar de novo depois. */
  async remove(id: string): Promise<boolean> {
    const url = apiUrl();
    if (!url) return false;
    const res = await request(`${url}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { [OwnerHeader]: ownerKey() } });
    return !!res && (res.ok || res.status === 403);
  },
};
