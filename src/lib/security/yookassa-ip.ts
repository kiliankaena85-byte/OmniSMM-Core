/**
 * YooKassa official webhook source ranges (INV-GW-01, SPEC-REDTEAM-GATEWAYS-2026).
 * Source: https://yookassa.ru/developers/using-api/webhooks (IP authentication section).
 * Defense-in-depth only: forwarded IP headers are spoofable — webhook authenticity is
 * guaranteed by mandatory API re-verification in PaymentService.confirmPayment.
 */
import { BlockList, isIP } from 'node:net';

const YOOKASSA_IPS = new BlockList();
YOOKASSA_IPS.addSubnet('185.71.76.0', 27, 'ipv4');
YOOKASSA_IPS.addSubnet('185.71.77.0', 27, 'ipv4');
YOOKASSA_IPS.addSubnet('77.75.153.0', 25, 'ipv4');
YOOKASSA_IPS.addSubnet('77.75.154.128', 25, 'ipv4');
YOOKASSA_IPS.addAddress('77.75.156.11', 'ipv4');
YOOKASSA_IPS.addAddress('77.75.156.35', 'ipv4');
YOOKASSA_IPS.addSubnet('2a02:5180::', 32, 'ipv6');

export function isYooKassaIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  return YOOKASSA_IPS.check(ip, version === 6 ? 'ipv6' : 'ipv4');
}
