export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
}

export interface UserPayload {
  sub: number;
  username: string;
  role: 'admin' | 'worker';
  real_name: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserPayload;
  };
};