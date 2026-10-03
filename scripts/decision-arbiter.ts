import 'dotenv/config';
import { db } from '../src/lib/db';
import fs from 'fs';

/**
 * Service Decision Arbiter (Модель Принятия Решений)
 * ===================================================
 * Назначение:
 * 1. Аудит и валидация соцсети (Network Confirmation)
 * 2. Аудит и валидация логики категории (Category Activity Invariant Confirmation)
 * 3. Аудит и валидация названия, устранение двусмысленности и White-Label (Name & Anti-Ambiguity Confirmation)
 */

export interface ServiceDecision {
  serviceId: string;
  originalName: string;
  originalNetwork: string;
  originalCategory: string;
  
  // Decision verdicts:
  networkDecision: 'CONFIRMED' | 'REASSIGNED' | 'REJECTED';
  targetNetworkSlug: string;

  categoryDecision: 'CONFIRMED' | 'REROUTED' | 'REPLACED_FROM_SHADOW' | 'REJECTED';
  targetCategorySlug: string;
  targetCategoryName: string;
  rerouteReason?: string;

  nameDecision: 'CONFIRMED' | 'CLEANED' | 'EXPANDED_FROM_SHADOW';
  finalName: string;
  
  // Custom Data & Link Engine flags:
  customDataType: 'NONE' | 'TEXTAREA' | 'NUMBER';
  isPrivate: boolean;
  qualityTier: 'ECONOMY' | 'STANDARD' | 'PREMIUM' | 'LIVE';
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function cleanServiceName(name: string, shadowName?: string | null): string {
  let text = name;
  if (text.includes('...') && shadowName && shadowName.length > text.length - 15) {
    const tierMatch = text.match(/\[(Эконом|Стандарт|Премиум|Живые|VIP)\]$/i);
    text = shadowName + (tierMatch ? ` [${tierMatch[1]}]` : '');
  }

  let cleaned = decodeHtmlEntities(text);

  // 1. White-label: Remove all provider brands
  const providerRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|smmpanelus|prosmm[- ]?shop|prosmm)\b/gi;
  cleaned = cleaned.replace(providerRegex, '');

  // 2. Remove leading tech prefixes
  cleaned = cleaned.replace(/^\s*(?:id\s*\d+|\d+\.)\s*/i, '');

  // 3. Remove technical provider tags
  cleaned = cleaned.replace(/\|\s*(?:S\d+|B\d+|MQ|VHQ|HQ\+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\b/gi, '');
  cleaned = cleaned.replace(/\b(?:S\d+|B\d+|MQ|VHQ|HQ\+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\|/gi, '');
  cleaned = cleaned.replace(/\[\s*(?:S\d+|B\d+|MQ|VHQ|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/gi, '');

  // 4. Remove ugly speed bracket tags: [0-1/Ч], [0-15/М], [100К/Д], [1000/day], etc.
  cleaned = cleaned.replace(/\[\s*\d+-\d+\/[ЧМчмHDhd]\s*\|?[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\|?[^\]]*\]/gi, '');

  // 5. Clean up pipes and redundant spaces
  cleaned = cleaned
    .replace(/\s*\|\s*\|\s*/g, ' | ')
    .replace(/\|\s*\]/g, ']')
    .replace(/\[\s*\|/g, '[')
    .replace(/\(\s*\|\s*/g, '(')
    .replace(/\s*\|\s*\)/g, ')')
    .replace(/\|\s*$/g, '')
    .replace(/^\s*\|\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned;
}

console.log('Decision Arbiter module defined.');
