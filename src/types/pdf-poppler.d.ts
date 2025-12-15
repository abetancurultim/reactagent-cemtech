// src/types/pdf-poppler.d.ts
declare module 'pdf-poppler' {
    export function convert(file: string, options?: any): Promise<void>;
    export function info(file: string): Promise<any>;
}