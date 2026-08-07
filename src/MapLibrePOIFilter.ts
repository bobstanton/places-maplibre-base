import { logger as rootLogger } from "places-shared/utils";

const logger = rootLogger.scope('POIFilter');

function extractFilterValues(patterns: string[]): string[] {
  const excludeValues: string[] = [];

  for (const pattern of patterns) {
    if (!pattern || !pattern.trim()) continue;

    const isSimple = /^[\w_-]+(\|[\w_-]+)*$/.test(pattern);

    if (isSimple) {
      const values = pattern.split('|').map(v => v.trim()).filter(Boolean);
      excludeValues.push(...values);
    } else {
      logger.debug(`Complex pattern "${pattern}" cannot be applied to vector tile layers (only to search results)`);
    }
  }

  return excludeValues;
}

export function isExpressionFilter(filter: unknown): boolean {
  if (!Array.isArray(filter)) return false;
  for (const item of filter) {
    if (Array.isArray(item)) {
      if (item[0] === 'get' || item[0] === 'literal') return true;
      if (isExpressionFilter(item)) return true;
    }
  }
  return false;
}

export function buildMapLibrePOIFilter(patterns: string[], classProperty: string = 'class', subclassProperty: string = 'subclass', expressionSyntax: boolean = false): unknown[] | null {
  if (!patterns || patterns.length === 0) return null;

  const excludeValues = extractFilterValues(patterns);
  if (excludeValues.length === 0) return null;

  if (expressionSyntax) {
    return [
      'all',
      ['!', ['in', ['get', classProperty], ['literal', excludeValues]]],
      ['!', ['in', ['get', subclassProperty], ['literal', excludeValues]]]
    ];
  }

  return [
    'all',
    ['!in', classProperty, ...excludeValues],
    ['!in', subclassProperty, ...excludeValues]
  ];
}

export function getPOILayerPatterns(): RegExp {
  return /^(poi|place[_-]?label|icon|point[_-]?label)/i;
}
