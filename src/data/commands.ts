export type BotId = "hammer" | "pencil" | "marco";
export type CommandBotId = Exclude<BotId, "marco">;

export type CommandOptionName = "rule" | "user" | "mention" | "color" | "spoiler" | "expression";

export interface CommandOption {
  name: CommandOptionName;
  default?: string;
  description: string;
  required?: boolean;
}

export interface BotCommand {
  id: string;
  bot: CommandBotId;
  cmd: string;
  description: string;
  options?: CommandOption[];
}

export interface Macro {
  name: string;
  aliases: string[];
  description: string;
}

export const hammerCommands: BotCommand[] = [
  {
    id: "hammer-rule",
    bot: "hammer",
    cmd: "/rule",
    description: "Returns information about a specific server rule.",
    options: [{ name: "rule", description: "Rule number (1–11)", required: true, default: "1" }],
  },
  {
    id: "hammer-selfhistory",
    bot: "hammer",
    cmd: "/selfhistory",
    description: "Returns your own infraction history on the server.",
  },
  {
    id: "hammer-userinfo",
    bot: "hammer",
    cmd: "/userinfo",
    description: "Returns base level information about a Discord member.",
    options: [{ name: "user", description: "The user to look up", required: true }],
  },
];

export const pencilCommands: BotCommand[] = [
  {
    id: "pencil-color",
    bot: "pencil",
    cmd: "/color",
    description:
      "Displays detailed information about a color. Accepts any color format such as hex, hsl, cmyk, and more.",
    options: [
      {
        name: "color",
        description: "The color to display (hex, rgb, hsl, cmyk)",
        required: true,
        default: "#fff",
      },
      { name: "mention", description: "User to mention with the result" },
    ],
  },
  {
    id: "pencil-tex",
    bot: "pencil",
    cmd: "/tex",
    description: "Nicely renders TeX formatted content inline in Discord.",
    options: [
      {
        name: "expression",
        description: "The TeX expression to render",
        required: true,
        default: "\\sqrt{b^2 - 4ac}",
      },
      { name: "spoiler", description: "Hide the result as a spoiler", default: "True" },
      { name: "mention", description: "User to mention with the result" },
    ],
  },
];

export const marcoMacros: Macro[] = [
  {
    name: "productive",
    aliases: ["deadchat"],
    description:
      "When chat dies, it's a good time to be productive instead of finding an excuse to not be productive; go for a walk, get water, say hi to loved ones, take a shower, clean your room, or even exercise!",
  },
  {
    name: "source",
    aliases: [],
    description: "https://github.com/BrackeysCommunity",
  },
  {
    name: "xyproblem",
    aliases: ["xy"],
    description:
      "The XY problem is asking about your attempted solution rather than your actual problem. This leads to enormous amounts of wasted time and energy, both on the part of people asking for help, and on the part of those providing help.\n\n- You want to do X\n- You don't know how to do X, but think you can solve it if you can just about manage to do Y\n- You don't know how to do Y either, so you ask for help with Y\n- Others try to help you with Y, but are confused because Y seems like a strange problem to want to solve\n- After much interaction and wasted time, it finally becomes clear that you really want help with X, and that Y wasn't even a suitable solution for X\nSource: <http://xyproblem.info/>\n\nPlease include information about a broader picture along with any attempted solution, including solutions you have already ruled out and why.",
  },
  {
    name: "learnc#",
    aliases: ["learn", "c#", "learncsharp", "csharp"],
    description:
      "__**Learn C# basics before starting with Unity!**__\n\nLearning the syntax of C# definitely helps when using Unity. Here are some links to get you started!\n- <https://docs.microsoft.com/en-us/dotnet/csharp/> (Microsoft's *Getting Started* Guide on C#)\n- <https://learn.microsoft.com/en-gb/shows/csharp-fundamentals-for-absolute-beginners/> (Teaches you the C# fundamentals)\n- <https://github.com/ossu/computer-science> (Not strictly C#, a general open-source education in Computer Science)\n- <https://www.classcentral.com/report/stanford-on-campus-courses> (Publicly available Computer Science courses from Stanford)\n- <https://codecademy.com/learn/learn-c-sharp> (Code Academy course on C#)\n\nMost programming problems come from not knowing how to use the language - if you haven’t programmed much or you’re not confident about the OOP concepts in your mind, it's useful to understand these before diving into the engine.",
  },
  {
    name: "learngit",
    aliases: ["learngithub", "git", "github"],
    description:
      "__**Git learning resources**__\n- <https://www.atlassian.com/git/tutorials> (Atlassian Git tutorials)\n- <https://www.w3schools.com/git/> (w3schools Git tutorial)\n- <https://www.youtube.com/watch?v=RGOj5yH7evk> (freeCodeCamp Git and GitHub tutorials)\n\n*If you are a looking for the BrackeysBot GitHub page, use `[]source`*",
  },
  {
    name: "screenshot",
    aliases: [],
    description:
      "**Capturing a screenshot on Windows**\nUse `Win+Shift+S`, select a region of your screen, and then paste it into Discord using `Ctrl+V`.\n(Works on Windows 11, and Windows 10 April 2017 update or later)\n\n**Capturing a screenshot on macOS**\nUse `Shift+Cmd+4`, select a region of your screen, and then paste it into Discord using `Cmd+V`.\n\n**Capturing a screenshot on Linux**\nThe screenshot shortcut may vary between distros.\nIf you are using Ubuntu: use `Shift+PrintScreen`, select a region of your screen, and then paste it into Discord using `Ctrl+V`.",
  },
  {
    name: "tryit",
    aliases: [],
    description:
      '__**Try it!**__\n\nWhenever you ask "can I do X" or "will Y work", the only thing you are doing is wasting time (including your own!)\nThe people you\'re asking aren\'t computers, humans can be wrong in their answers. We also don\'t have access to your project or know your intentions.\nThe only way to know if something works as you wanted it to, is to try it for yourself!',
  },
  {
    name: "codeblock",
    aliases: ["cb"],
    description:
      '__**Use codeblocks to send code in a message!**__\n\nTo make a codeblock, surround your code with \\`\\`\\` (3 backticks. [Click here](<https://superuser.com/a/254077>) to see where the key is)\n\nTo use syntax highlighting, add the file extension of the language you wish to highlight (`cs` for C#, `cpp` for C++)\n\nFor example:\n\\`\\`\\`cs\nConsole.WriteLine("Hello World");\n\\`\\`\\`\n\nProduces:\n```cs\nConsole.WriteLine("Hello World");\n```\n\nTo send lengthy code, paste it into <https://paste.myst.rs/> and send the link of the paste into chat.',
  },
  {
    name: "passby",
    aliases: [],
    description:
      "https://blog.penjee.com/wp-content/uploads/2015/02/pass-by-reference-vs-pass-by-value-animation.gif",
  },
  {
    name: "ddg",
    aliases: [],
    description: "Sounds like something https://ddg.gg/ would know!",
  },
  {
    name: "google",
    aliases: [],
    description: "Sounds like something https://google.com/ would know!",
  },
  {
    name: "jbstudent",
    aliases: [],
    description:
      "__**JetBrains Student Pack**__\n\nIf you're a student you can get JetBrains products for free, all you have to do is register with your student email or confirm that you're a student with some form of ID. More info here: https://www.jetbrains.com/shop/eform/students",
  },
  {
    name: "pleasewait",
    aliases: [],
    description:
      "Spamming the help channels or posting your question in all channels (<#243005537342586880> for example) won't result in your solving your issues faster.\n\nThis is a pretty big server, with a lot of people needing help. The ratio of people that need help and the ones that do help is very small.\n\nHave patience. Try to solve the problems yourself.",
  },
  {
    name: "projectideas",
    aliases: ["projectidea"],
    description:
      "These are some links with ideas for small projects!\n- <https://github.com/karan/Projects>\n- <https://github.com/joereynolds/what-to-code>\n- <http://andrewcombs13.com/projectIdeas/>\n- <https://www.reddit.com/r/dailyprogrammer/>\n- <https://qph.fs.quoracdn.net/main-qimg-2fa8b318be75adf3d32f85eb42d2422e-c>\n- <https://github.com/scraggo/bookmarks-programming/blob/master/project-ideas.md>\n- <https://rosettacode.org/wiki/Category:Programming_Tasks>",
  },
  {
    name: "tape",
    aliases: [],
    description: "Better be careful or you get the tape! <a:tape_time:827550717325475857>",
  },
  {
    name: "demod",
    aliases: [],
    description: "@silent <@265536255696175104> is no longer mod",
  },
  {
    name: "🥄",
    aliases: ["spoon", "spoonfeed"],
    description:
      "We are not here to spoon-feed solutions to you but to try and help you understand a problem. Most generic issues can be googled and we encourage you to do so because knowing how to use Google is an essential skill as well!",
  },
  {
    name: "askhere",
    aliases: [],
    description:
      "It is better to ask your question here so everyone can read it, so that more people are able to help you!",
  },
  {
    name: "basics",
    aliases: [],
    description:
      "__**Why are the basics important?**__\nWe understand, games are amazing so what could be even better than making games?! The downside is, there are a lot of different aspects to game development that have to come together. Jumping into the deep can, for some, work. But often times it’ll be extremely intimidating and will cause you to run into issues not related to game development, but much rather with the basics of the discipline. Especially when programming this occurs quite a bit, for example not knowing the basic structure of a script. And when you have to learn both the basics of programming, together with the basics of Unity, you make it harder for yourself than it needs to be due to Unity’s API which you’d also have to learn how to use, and in a lot of cases uses more advanced topics than just the basics.\n\nIf you however start learning C# on it’s own you gain experience with programming, and are later able to implement the things you’ve learned doing just programming, while learning Unity. Meaning there are less things for you to learn, and more game making for you to do.",
  },
  {
    name: "nocode",
    aliases: [],
    description:
      "__**It's hard to answer a programming question without code**__\n\nResolving a bug is almost impossible when the question doesn't include any of the buggy code. In order to help fix the problem, answerers are going to have to see what the code is.\nSource: <https://idownvotedbecau.se/nocode>\n\nPlease isolate the problematic code and send it as a codeblock. If you don't know how to send a codeblock, type `[]cb`",
  },
  {
    name: "unclearquestion",
    aliases: [],
    description:
      "__**Before others can help, a clear question must be formulated**__\n\nWhen you ask a difficult question it is your responsibility to ensure that anyone reading it will have all of the information they need to understand and diagnose the problem. Sometimes questions aren’t as clear to others as they could be or they may be missing critical information needed to provide a correct answer.\nSource: <https://idownvotedbecau.se/unclearquestion>\n\nPlease elaborate on your question by including all the relevant information such as:\n- The programming language within which you're working (if it is anything other than C#)\n- Exactly what it is you're trying to accomplish\n- Things you have considered/attempted already\n- Anything else that could aid answerers in resolving the issue",
  },
  {
    name: "nullreference",
    aliases: ["null"],
    description:
      "`NullReferenceException` means that you either never assigned an object to variable, or set it to null.\n\nDo `Debug.Log(yourVariable == null)` before the line with the error to test if that's the case.\n\nYou can look into:\n• <https://docs.microsoft.com/en-gb/dotnet/api/system.nullreferenceexception>\n• <https://docs.unity3d.com/Manual/NullReferenceException.html>",
  },
  {
    name: "poorquestion",
    aliases: ["poorq", "badq"],
    description:
      "__**It's hard to answer a poorly asked question**__\nIn order for someone to be able to help you, they must understand the issue/code/etc. properly. Not posting the code/explaining the issue/etc. would make it very inconvenient for the helper. Please make sure your question has the proper information and structure so that other users will be able to help you much efficiently, and thus solve your problem more easily and fast.\n\nWe recommend taking a look at this video to know what makes a good question:\nhttps://www.youtube.com/watch?v=53zkBvL4ZB4",
  },
  {
    name: "nointellisense",
    aliases: ["noint", "intellisense"],
    description:
      "__**How to deal with no VS intellisense problem:**__\nIf you have opened script and see Miscellaneous Files in place where should be name of your project (see screenshot below) it means that the file was not correctly loaded into project or you don't have any project loaded. Follow these steps to fix this:\n- *Unity tools and Unity IDE preference* - make sure to install the Visual Studio Tools for Unity in your VS Installer and check the Unity preferences `Edit - Preferences - External Tools` and verify that the right External Script Editor is selected (you want Visual Studio there).\n- *Reload project* - `View - Solution Explorer` right click on project and click Unload project then right click on it again and load it again. If you don't see any project in Solution Explorer then move to the next step.\n- Regenerate solution files - Remove the `.sln` and `.csproj` files from root of your unity project (in File Explorer), they will be regenerated next time you open script from Unity.\n\n__**How to deal with no VSCode intellisense problem:**__\nFollow the guidelines on this page:\n<https://code.visualstudio.com/docs/other/unity>\n\nhttps://media.discordapp.net/attachments/674324348559032320/1207285047141470218/image.png?ex=65df16d1&is=65cca1d1&hm=f3c3ae40d3df7b47f31d20ae8da60125679b4e18ca2943921726fe5f167a9fad&=&format=webp&quality=lossless&width=654&height=186",
  },
  {
    name: "imageofcode",
    aliases: ["ioc"],
    description:
      "__**An image of your code is not helpful**__\n\nWhen asking a question about a problem with code, people who are volunteering to help need the text of the code. Unless you are asking about your IDE - and not the code itself - images of the code are not an acceptable substitute.\nSource: <https://idownvotedbecau.se/imageofcode>\n\nPlease send your code as a codeblock. If you don't know how to send a codeblock, type `[]cb`",
  },
  {
    name: "imageofanexception",
    aliases: ["imageofexception", "imageofanerror", "imageoferror", "ioe"],
    description:
      "__**Pictures of exceptions are not helpful**__\n\nPasting a picture of an error or an exception is not helpful. It is not required to prove that the error happened – you are trusted when you state this fact within the question. It is the details omitted by these images that is the problem, as these images only contain part of the information.\nSource: <https://idownvotedbecau.se/imageofanexception>\n\nPlease copy and paste the error as text so that we can further understand all of the relevant information, and point out the exact line that is throwing the error, as this saves the time of those who are helping you!",
  },
  {
    name: "nofind",
    aliases: [],
    description:
      "__**Don't use `Find` methods!**__\n\n`Find` methods in Unity are an often-tempting solution to referencing a scene object. However, there is always a better solution.\nWhenever you call a `Find` method, Unity must traverse your entire scene hierarchy and check every single object until it finds a match; and the methods which return arrays will always traverse the entire hierarchy regardless.\nThis is inefficient! It means that the more objects you add to your scene, the slower these methods become; and it gets even worse if you are calling them multiple times.\n\nA non-exhaustive list of `Find` methods to __avoid__:\n<https://docs.unity3d.com/ScriptReference/GameObject.FindWithTag.html>\n<https://docs.unity3d.com/ScriptReference/Object.FindObjectsOfType.html>\n<https://docs.unity3d.com/ScriptReference/Object.FindObjectOfType.html>\n\nTo read about a better solution, type `[]getareference` or `[]getref`",
  },
  {
    name: "justajoke",
    aliases: [],
    description:
      "__**Schrodinger's douchebag**__\n\nSomeone who says or does something offensive, and determines whether it was a joke based on the response of others.",
  },
  {
    name: "getareference",
    aliases: ["ref", "reference", "getref"],
    description:
      '__**How to get a reference**__\n"How do I access a variable from another script?" is usually one of the first questions we ask when learning Unity. Whether you are C# beginner or a C# professional, understanding the way Unity does things differently can be confusing.\n\n🌳 __If the objects are already present in the scene hierarchy...__\n... then you can use the SerializeField attribute on a field, and assign it by dragging the object which has the script you want to access onto the field slot. This also works if the two scripts are on the same object.\n```cs\n[SerializeField] private SomeScript someScript;\n```\n\n<:prefab:797631836121595935> __If the objects are instantiated prefabs...__\n... then you can use a form of injection after you call Instantiate:\n`SomeScript.cs`\n```cs\npublic GameManager TheManager { get; set; }\n```\n`GameManager.cs`\n```cs\nvar clone = Instantiate(prefab);\nclone.GetComponent<SomeScript>().TheManager = this;\n```',
  },
  {
    name: "gameidea",
    aliases: [],
    description:
      "Want to make a game but don't have an idea?\nTry using https://seblague.github.io/ideagenerator/ !",
  },
  {
    name: "deltatime",
    aliases: [],
    description:
      "`Time.deltaTime` is the amount of seconds it took for unity to calculate and render last frame. Let's say your game runs at a constant 100 frames per second, then `Time.deltaTime` will be 0.01f every frame. But games usually don't run at a constant frame rate so Time.deltaTime compensates for that. \n\nFor example:\n```cs\nprivate void Update()\n{\n    transform.position += new Vector3(0f, 0f, 10f);\n}\n```\n```cs\nprivate void Update()\n{\n    transform.position += new Vector3(0f, 0f, 10f) * Time.deltaTime;\n}\n```\n\nIn the first example; if the game runs at 100 fps, the object will move twice as fast compared to if the game ran at 50 fps.\nBut let's look at the second example:\n\nIf the game is running at **100 fps**: the object will move by (10 * 0.01) **0.1 units every frame**, therefore moving (0.1 * 100) **10 units every second**.\nIf the game is running at **50 fps**: the object will move by (10 * 0.02) **0.2 units every frame**, therefore moving (0.2 * 50) **10 units every second**.\nIf the game is running at **20 fps**: the object will move by (10 * 0.05) **0.5 units every frame**, therefore moving (0.5 * 20) yet again **10 units every second**.",
  },
  {
    name: "crosspost",
    aliases: ["xpost"],
    description:
      "Please don't crosspost! Be patient when you ask your question, we all have questions and there are only so many people to answer them. Posting in multiple channels is spamming and doesn't help anyone.",
  },
  {
    name: "channels",
    aliases: [],
    description: "<#552209553886806046>\nhttps://imgur.com/Av9GllQ.gif",
  },
  {
    name: "binaryformatter",
    aliases: [],
    description:
      "Due to security issues with the BinaryFormatter, it should not be used in any case.\nhttps://docs.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide",
  },
  {
    name: "learncpp",
    aliases: [],
    description:
      "Great youtube tutorial series: <https://www.youtube.com/playlist?list=PLlrATfBNZ98dudnM48yfGUldqGD0S4FFb>\nC++ reference: <https://en.cppreference.com/w/>",
  },
  {
    name: "learnshaders",
    aliases: ["shaders"],
    description:
      "Shaders can be a great way to graphically enhance your game, but they can be tricky to get into! Here are some resources to get you started!\n\n<https://www.raywenderlich.com/5671826-introduction-to-shaders-in-unity> - The basics in the standard pipeline.\n<https://catlikecoding.com/unity/tutorials/scriptable-render-pipeline/> - Various beginner and intermediate shader tutorials.\n<https://www.ronja-tutorials.com/> - Probably one of the best online tutorials for basic versions of different shaders, whilst still breaking them down easily.\n<https://www.alanzucconi.com/category/shader/> - Alan taking his own perspectives on shaders whilst showing how to do them.\n<https://www.shadertoy.com/> - A nice resource to have to really show the power that can go in to them [inspiration, passion etc and general amazement at some of the cool stuff on there].",
  },
  {
    name: "cclist",
    aliases: [],
    description:
      "This command is no longer in use. Use the `/listmacros` slash command for a list of macros!",
  },
  {
    name: "noresearch",
    aliases: [],
    description:
      "__**Research is an important first step in solving problems**__\n\nSolving problems can be hard work. When we have exhausted our own knowledge, it's often tempting to simply ask someone else to solve the problem for us. It is very common to find the question we have is one many people have already experienced, and many of these people have already asked about it and have received correct answers in response.\nSource: <https://idownvotedbecau.se/noresearch>\n\nIf you've done your research, please state what you've already attempted in your question to avoid being offered a solution that you've already attempted. This saves time on everybody's part!",
  },
  {
    name: "banning",
    aliases: [],
    description: "https://media.tenor.com/B8Dmbo5CkDMAAAAC/ban-buckle.gif",
  },
  {
    name: "marco",
    aliases: [],
    description: "Polo!",
  },
  {
    name: "vsvsvscode",
    aliases: ["vsvscode", "vscode", "vs"],
    description:
      "Visual Studio Code is a lightweight text editor that supports extensions, letting it support a number of different languages.\nVisual Studio is a full Integrated Development Environment (IDE), and as such offers better tools to equip developers with everything they need when writing apps and games.\n\nSince Visual Studio Code is more lightweight, it lacks a lot of the useful features ideal for working with .NET, and so we recommend using Visual Studio when writing C# or working with Unity.",
  },
  {
    name: "itsnotworking",
    aliases: ["notworking", "doesntwork", "itdoesntwork"],
    description:
      '__**"It\'s not working" is not helpful**__\n\nIn order for a question to be answered, it must specify what exactly is wrong. Stating simply that "it doesn\'t work" is not sufficient.\nSource: <https://idownvotedbecau.se/itsnotworking>\n\nPlease elaborate on your question by including all relevant details. What do you think is the problem? Have you tried to fix it? If you have, why didn\'t that work?',
  },
  {
    name: "chatgpt",
    aliases: [],
    description:
      "If you've used ChatGPT to generate code, it's important to acknowledge the code may not work as intended, or at all. AIs such as these work similarly to predictive text on your phone, but on a much more advanced level - it is simply predicting a response you'd like to hear. They don't understand the nuances of your project, nor your specific requirements.\n\nChatGPT is a useful tool to help you decide on an overall structure, but blindly copying and pasting code it generates is almost guaranteed to fail. Try solving the problems on your own first, and Google for help before relying on AI.",
  },
  {
    name: "mentalhealth",
    aliases: ["suicide", "crisis", "hotline"],
    description:
      "We kindly request you refrain from engaging in discussions centered around mental health. We understand the importance of this topic and genuinely care about the well-being of all our members. Our intention is to ensure the safety and protection of everyone involved, which is why rule 2 exists.\n\nThe internet can be a vast and unpredictable space, and it's crucial to recognize that seeking advice from strangers may not always provide reliable or accurate guidance. We strongly encourage those who are struggling with mental health issues to reach out to professional resources, such as therapists, counselors, or helplines, who can offer the necessary expertise and support tailored to their specific needs.\n\nIf you are in a crisis, please call a relevant hotline in your country.\nUS: 988 (Suicide & Crisis Lifeline)\nUK: 116 123 (Samaritans)\nWales: 0800 132 737 (C.A.L.L)\nAustralia: 13 11 14 (Lifeline)\nFrance: 3114 (Numéro national de prévention du suicide)\nNetherlands: 113 (Zelfmoordpreventie)",
  },
  {
    name: "pride",
    aliases: ["rainbow"],
    description:
      "**Why is the logo a rainbow? This has been happening to more servers I am in and I'm confused!**\nWe, like many other servers, have changed our logo to wear the colors of the pride flag. This is to celebrate the currently ongoing pride month.\n\n**What is LGBTQ+ or Gay Pride?**\nIt is a movement that celebrates sexual diversity. For **L**esbian, **G**ay, **B**isexual, **T**ransgender, intersex, **Q**ueer/questioning, asexual, and other members of the LGBTQ+ community, it is a way of protesting about discrimination and violence. It promotes their dignity, equal rights, self-affirmation and is a way of increasing society’s awareness of the issues they face.\n\n**I'm still confused, do you have more information?**\nYes! Check out this website to find out more about pride month and why it happens in June of every year!\n<https://www.awarenessdays.com/awareness-days-calendar/pride-month-2025/>\n\n**I don't support pride because of x**\nThat's fine! We're not here to force you to support anything you don't necessarily agree with, be that for religious reasons or any other reason. We, as a server, simply want to show our support to those in this community to make sure they know they are welcome here without any hatred going their way.\nHaving another opinion regarding this subject, however, does not mean you can aggressively voice that opinion. Insults, derogatory language, hate speech, or any form of chat etiquette rule breaking is still rule breaking.\nWe stand firmly against intolerance!",
  },
  {
    name: "besttool",
    aliases: ["whichtool", "tools"],
    description: "https://i.imgur.com/7bUE2k6.png",
  },
  {
    name: "remod",
    aliases: [],
    description: "@silent <@265536255696175104> is mod again!",
  },
  {
    name: "ianal",
    aliases: ["lawyer", "legal", "legaladvice", "wanl"],
    description:
      "__**We Are Not Lawyers**__\nWe are a community of game dev and programming enthusiasts, and should not be a substitute for professional legal advice.\n\nDo not take legal advice from random strangers on the internet. Please consult with a lawyer.",
  },
  {
    name: "helpchat",
    aliases: [],
    description:
      "<#1233892569503760486> is for brief questions with quick answers. If you have a complicated question or want focused attention, use the Development & Help category (see <#552209553886806046>)",
  },
  {
    name: "rule",
    aliases: [],
    description:
      "The `[]rule` command is no longer in use. Use the `/rule` slash command to display rules.",
  },
  {
    name: "deop",
    aliases: [],
    description: "@silent <@94248427663130624> is no longer admin",
  },
  {
    name: "imageperms",
    aliases: ["wherethehellismyembed", "whycantipostlinks", "whycantipostimages"],
    description:
      "Due to a recent onslaught of NSFW spammers, image and link permissions have been temporarily restricted. We apologise for the inconvenience. If the staff judge you to be trustworthy, you will be granted these permissions.",
  },
  {
    name: "mellowho",
    aliases: [],
    description: "@silent <@265536255696175104> needs to watch Doctor Who",
  },
];

export const allBotCommands: BotCommand[] = [...hammerCommands, ...pencilCommands];
