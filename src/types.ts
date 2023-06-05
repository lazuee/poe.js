export type Promisable<T> = T | PromiseLike<T>;

export type Prompt = string | Conversation[];

export interface Conversation {
	role: "user" | "system" | "model";
	content: string;
	name?: string;
}
