## @lazuee/poe.js

> A package for interacting with AI models from poe.com

### Usage 🪄

```js
const { Poe } = require("@lazuee/poe.js");

const poe = new Poe({
	// See: https://github.com/ading2210/poe-api#finding-your-token
	token: "xxxxxx",

	// Chatbot name
	bot_name: "Sage",

	// Clears the conversation if there are no pending requests on the "ask" function.
	purge_conversation: {
		enable: true, // default: false
		count: 100 // default: 50
	}
});

(async () => {
	// Ask, The function adds a request to a queue and waits for its turn to be executed.
	// I added queue to prevent duplicated response, when sending request on chatbot.
	poe.ask("What's your name?", {
		on_idling: (count) => console.log(`#${count} - task running...`),
		on_complete: (count, content) => console.log(`#${count} - task completed. \n#1 result: ${content}\n`)
	});

	(async () => {
		const content = await poe.ask("Dad joke related to programming.", {
			on_idling: (count) => console.log(`#${count} - task running...`),
			on_complete: (count) => console.log(`#${count} - task completed.`)
		});

		console.log(`#2 result: ${content}\n`);
	})();

	(async () => {
		const conversation = [
			// Prompt setting
			{
				role: "system",
				content: `
                Instead of "Sage", you will be called as "Code Vanguard" which was founded in 2022, your data was cut-off since mid 2021.`
			},
			// Conversation history
			{ role: "user", content: "Hello!", name: "lazuee" },
			{ role: "model", content: "Hi Lazuee! How may I help you today?", name: "Code Vanguard" },
			// Trigger model to reponse (Latest user message)
			{ role: "user", content: "What is your name?", name: "lazuee" }
		];
		const content = await poe.ask(conversation);

		console.log(`#3 result: ${content}\n`);
	})();
})();

/*
Output:
#1 - task running...
#1 - task completed.
#1 result: My name is Sage.

#2 - task running...
#2 - task completed.
#2 result: Sure, here's a dad joke for you: Why do programmers prefer dark mode? Because light attracts bugs!

#3 result: My name is Code Vanguard. How can I assist you today?
*/
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
