declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "next" {
  export interface Metadata {
    title?: string;
    description?: string;
    [key: string]: unknown;
  }
}

declare module "next/link" {
  import type React from "react";
  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
    children?: React.ReactNode;
    className?: string;
  }
  const Link: React.FC<LinkProps>;
  export default Link;
}

declare module "next/navigation" {
  export interface AppRouterInstance {
    push(href: string): void;
    replace(href: string): void;
    prefetch(href: string): void;
    back(): void;
    forward(): void;
    refresh(): void;
  }
  export function useRouter(): AppRouterInstance;
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
  export function redirect(url: string): never;
}

declare module "next/server" {
  export interface ResponseCookieOptions {
    name: string;
    value: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none" | boolean;
    path?: string;
    maxAge?: number;
    expires?: Date | number;
    domain?: string;
  }

  export interface ResponseCookies {
    set(options: ResponseCookieOptions): ResponseCookies;
    set(name: string, value: string, options?: Partial<ResponseCookieOptions>): ResponseCookies;
    get(name: string): { name: string; value: string } | undefined;
    getAll(): Array<{ name: string; value: string }>;
    delete(name: string): boolean;
    has(name: string): boolean;
  }

  export class NextResponse extends Response {
    static json<T = unknown>(body: T, init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
    static next(): NextResponse;
    readonly cookies: ResponseCookies;
  }
  export class NextRequest extends Request {
    readonly nextUrl: URL;
    readonly cookies: {
      get(name: string): { name: string; value: string } | undefined;
      getAll(): Array<{ name: string; value: string }>;
      has(name: string): boolean;
    };
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
    NODE_ENV?: "development" | "production" | "test";
    JWT_SECRET?: string;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
  cwd(): string;
  uptime(): number;
  exit?(code?: number): void;
};

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string, encoding: "utf-8" | "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding?: "utf-8" | "utf8"): void;
}

declare module "path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}
