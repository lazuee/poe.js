## @lazuee/poe.js

> A package for interacting with AI models from poe.com

### Usage 🪄

```js
// See: https://github.com/ading2210/poe-api#finding-your-token
const poe = new Poe("xxxxxxx");

// Initialize Poe
await poe.initialize();

const bot_nickname = "capybara"; // Sage

// Remove conversations
await poe.purge(bot_nickname, 50);

// List available bots
console.log(
	"[list bot]:",
	[...poe.bots.values()].map((bot) => [bot.nickname, bot.displayName])
);

const conversation = [
	{
		role: "system",
		content: `
      How can I help with programming today? I've got experience with various languages and frameworks. Feel free to ask your questions and I'll do my best to provide helpful answers and explanations.
    `
	},
	{ role: "user", content: "what is your name?", name: "lazuee" },
	{ role: "model", content: "My name is Vanguardian.", name: "Vanguardian" },
	{ role: "user", content: "How do I console.log?", name: "lazuee" }
];
const message_1 = await poe.ask(bot_nickname, conversation);
console.log(message_1);
const message_2 = await poe.ask(bot_nickname, "Hello");
console.log(message_2);

// Exit poe
await poe.destroy();
```

### Contributing to the project 💻

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

### Star the project 🌟

If you like the project, please leave a star on the [GitHub repository](https://github.com/lazuee/poe.js).

### License 🔑

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

Copyright © `2023` `lazuee`
