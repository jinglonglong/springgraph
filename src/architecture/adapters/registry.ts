import { AnnotationAdapterRegistry } from './types';
import { springAnnotationsAdapter } from './spring-annotations';
import { springWebAdapter } from './spring-web';
import { springScheduleEventAdapter } from './spring-schedule-event';
import { mapStructAdapter } from './mapstruct';
import { lombokAdapter } from './lombok';
import { mybatisAnnotationsAdapter } from './mybatis-annotations';
import { validationAdapter } from './validation';
import { openApiAdapter } from './openapi';
import { ruleBasedAdapter } from './rule-based';

/**
 * Pre-registered annotation adapter registry singleton.
 *
 * This registry automatically initializes with all 9 built-in adapters
 * in the canonical order: spring-annotations, spring-web, spring-schedule-event,
 * mapstruct, lombok, mybatis-annotations, validation, openapi, rule-based.
 *
 * Usage:
 * ```typescript
 * import { annotationAdapterRegistry } from './adapters/registry';
 *
 * // Get all registered adapters
 * const adapters = annotationAdapterRegistry.getAdapters();
 *
 * // Get a specific adapter by ID
 * const springAdapter = annotationAdapterRegistry.getAdapter('spring-annotations');
 *
 * // Register a custom adapter
 * annotationAdapterRegistry.register(customAdapter);
 * ```
 */
class AnnotationAdapterRegistrySingleton extends AnnotationAdapterRegistry {
  private static instance: AnnotationAdapterRegistrySingleton | null = null;

  private constructor() {
    super();
    this.registerBuiltInAdapters();
  }

  static getInstance(): AnnotationAdapterRegistrySingleton {
    if (!AnnotationAdapterRegistrySingleton.instance) {
      AnnotationAdapterRegistrySingleton.instance = new AnnotationAdapterRegistrySingleton();
    }
    return AnnotationAdapterRegistrySingleton.instance;
  }

  private registerBuiltInAdapters(): void {
    // Register all 9 built-in adapters in canonical order
    this.register(springAnnotationsAdapter);
    this.register(springWebAdapter);
    this.register(springScheduleEventAdapter);
    this.register(mapStructAdapter);
    this.register(lombokAdapter);
    this.register(mybatisAnnotationsAdapter);
    this.register(validationAdapter);
    this.register(openApiAdapter);
    this.register(ruleBasedAdapter);
  }

  /**
   * Reset the singleton instance (for testing purposes only).
   */
  static resetInstance(): void {
    AnnotationAdapterRegistrySingleton.instance = null;
  }
}

/**
 * Pre-configured annotation adapter registry with all built-in adapters.
 */
export const annotationAdapterRegistry: AnnotationAdapterRegistry =
  AnnotationAdapterRegistrySingleton.getInstance();

/**
 * Get a fresh registry instance (for testing or when you need a clean slate).
 */
export function createFreshRegistry(): AnnotationAdapterRegistry {
  AnnotationAdapterRegistrySingleton.resetInstance();
  return AnnotationAdapterRegistrySingleton.getInstance();
}
