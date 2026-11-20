package api

// Paths of goals, guilds and classes (GDD 4.8, 5.8, 11).
const (
	PathGoals   = "/v1/goals"
	PathBoard   = "/v1/goals/forum"
	PathGuild   = "/v1/guild"
	PathClasses = "/v1/classes"
)

// Action kinds of goals, guilds, settlements and classes.
const (
	ActPostGoal     = "goal-post"
	ActPledge       = "goal-pledge"
	ActDeliverGoal  = "goal-deliver"
	ActTakeHaul     = "goal-haul"
	ActWithdrawGoal = "goal-withdraw"
	ActCallHelp     = "help"
	ActCarry        = "carry"
	ActHideGoal     = "goal-hide"
	ActFoundGuild   = "guild-found"
	ActInvite       = "guild-invite"
	ActJoin         = "guild-join"
	ActLeave        = "guild-leave"
	ActPromote      = "guild-promote"
	ActVote         = "guild-vote"
	ActDeposit      = "guild-deposit"
	ActPay          = "guild-pay"
	ActApprove      = "guild-approve"
	ActDraw         = "guild-draw"
	ActAllow        = "guild-allow"
	ActWork         = "guild-work"
	ActFound        = "found"
	ActCharter      = "charter"
	ActRaise        = "raise"
	ActMend         = "mend"
	ActChooseClass  = "class-choose"
	ActTakeAbility  = "class-take"
	ActMarkPrey     = "mark"
)

// Condition is a goal's verb, target and amount (GDD 11.2); empty fields
// match anything.
type Condition struct {
	Verb    string `json:"verb"`
	Kind    string `json:"kind,omitempty"`
	Tag     string `json:"tag,omitempty"`
	Trait   string `json:"trait,omitempty"`
	Count   int64  `json:"count"`
	At      string `json:"at,omitempty"`
	Hex     *Hex   `json:"hex,omitempty"`
	Within  int64  `json:"within,omitempty"`
	From    string `json:"from,omitempty"`
	Field   string `json:"field,omitempty"`
	AtLeast int64  `json:"atLeast,omitempty"`
	Gauge   string `json:"gauge,omitempty"`
	Line    int64  `json:"line,omitempty"`
	Below   bool   `json:"below,omitempty"`
	Who     string `json:"who,omitempty"`
	Side    string `json:"side,omitempty"`
}

// GoalSpec is a goal as posted: picked by selects, the title and note
// from a modal.
type GoalSpec struct {
	Title    string    `json:"title"`
	Note     string    `json:"note,omitempty"`
	Issuer   string    `json:"issuer"` // character, party, settlement, admin
	Members  []string  `json:"members,omitempty"`
	Cond     Condition `json:"cond"`
	Reward   int64     `json:"reward"`
	Mode     string    `json:"mode"`
	Cap      int64     `json:"cap,omitempty"`
	Lifetime string    `json:"lifetime"`
	Turnover string    `json:"turnover"`
	Ticks    int64     `json:"ticks,omitempty"`
	Even     bool      `json:"even,omitempty"`
	Material string    `json:"material,omitempty"`
	Units    int64     `json:"units,omitempty"`
}

// Goal is a posted goal as the board shows it.
type Goal struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Note     string `json:"note,omitempty"`
	Issuer   string `json:"issuer"` // its kind
	By       string `json:"by"`     // who issued it, by name
	Verb     string `json:"verb"`
	What     string `json:"what"` // the condition in words
	Where    string `json:"where,omitempty"`
	Reward   int64  `json:"reward"`
	Mode     string `json:"mode"`
	Cap      int64  `json:"cap,omitempty"`
	Lifetime string `json:"lifetime"`
	Turnover string `json:"turnover"`
	State    string `json:"state"`
	Progress int64  `json:"progress"`
	Count    int64  `json:"count"`
	Claims   int64  `json:"claims"`
	Need     int64  `json:"need,omitempty"`
	Pledged  int64  `json:"pledged,omitempty"`
	// Left is ticks until it expires; 0 for none.
	Left int64 `json:"left,omitempty"`
	Mine bool  `json:"mine"`
	// Yours is the character's own progress toward it.
	Yours  int64          `json:"yours"`
	Top    []Contribution `json:"top"`
	Hauler string         `json:"hauler,omitempty"`
	Vow    bool           `json:"vow,omitempty"`
	// Takes are the goods the viewer carries that a Deliver takes; Haul is
	// whether the viewer may take its stock here, or deliver it here.
	Takes    []Goods `json:"takes"`
	Haul     string  `json:"haul,omitempty"`     // take, deliver
	Building string  `json:"building,omitempty"` // the structure a raise goal builds
	// Paid are a met goal's claims, each with the facts it cites.
	Paid []GoalClaim `json:"paid,omitempty"`
}

// GoalClaim is one claim on a met goal: who, for how much, and the facts
// that met it. Cited counts every fact; Facts are those still at hand.
type GoalClaim struct {
	Who   string `json:"who"`
	Units int64  `json:"units"`
	Coin  int64  `json:"coin"`
	Cited int64  `json:"cited"`
	Facts []Fact `json:"facts"`
}

// Contribution is a contributor's units toward a goal.
type Contribution struct {
	Who   string `json:"who"`
	Units int64  `json:"units"`
}

// Draft is a goal the board suggests from the state of the world.
type Draft struct {
	Why  string   `json:"why"`
	Spec GoalSpec `json:"spec"`
}

// Goals is /goals for a character in a settlement: the board, drafts,
// its own goals and the rules a post is checked against.
type Goals struct {
	Settlement  int      `json:"settlement"`
	Name        string   `json:"name"`
	Board       []Goal   `json:"board"`
	Drafts      []Draft  `json:"drafts"`
	Mine        []Goal   `json:"mine"`
	Met         []Goal   `json:"met"` // the latest goals met on this board
	Live        int64    `json:"live"`
	Limit       int64    `json:"limit"`
	Fee         int64    `json:"fee"` // per cent of the reward
	FeeLeast    int64    `json:"feeLeast"`
	RewardLeast int64    `json:"rewardLeast"`
	PledgeNeed  int64    `json:"pledgeNeed"`
	Verbs       []string `json:"verbs"`
	Officer     bool     `json:"officer"`
	Coin        int64    `json:"coin"`
	Banner      string   `json:"banner"`
	// Targets are what each verb may be posted against from here; Line,
	// Within and Ephemeral are the defaults the form fills in: a Hold's
	// threat line, a Discover's reach in tiles, an ephemeral goal's ticks.
	Targets   []Targets `json:"targets"`
	Line      int64     `json:"line"`
	Within    int64     `json:"within"`
	Ephemeral int64     `json:"ephemeral"`
	At        Hex       `json:"at"`
}

// Targets are the choices a verb offers on the posting form.
type Targets struct {
	Verb    string `json:"verb"`
	Options []Pick `json:"options"`
}

// Pick is one option of a select: the value sent and what it shows.
type Pick struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// Board is every settlement's notice-board goals, for the forum: a post
// per goal, its progress edited on a timer.
type Board struct {
	Tick int64 `json:"tick"`
	// Every is the least ticks between two edits of one post.
	Every int64       `json:"every"`
	Posts []BoardPost `json:"posts"`
}

// BoardPost is one goal's forum post.
type BoardPost struct {
	Settlement int    `json:"settlement"`
	Name       string `json:"name"`
	Banner     string `json:"banner"` // a media key
	Goal       Goal   `json:"goal"`
}

// CostLine is goods of a tag, or coin when the tag is empty.
type CostLine struct {
	Tag      string `json:"tag,omitempty"`
	Quantity int64  `json:"quantity"`
}

// Structure is one of a settlement's structures (GDD 4.16).
type Structure struct {
	Kind      string     `json:"kind"`
	Name      string     `json:"name"`
	Tier      int64      `json:"tier"`
	MaxTier   int64      `json:"maxTier"`
	Condition int64      `json:"condition"`
	Closed    bool       `json:"closed"`
	Raising   bool       `json:"raising"`
	Next      []CostLine `json:"next,omitempty"`
}

// Settlement is a settlement a guild runs.
type Settlement struct {
	N          int         `json:"n"`
	Name       string      `json:"name"`
	Treasury   int64       `json:"treasury"`
	Structures []Structure `json:"structures"`
	Here       bool        `json:"here"`
}

// GuildMember is one member on the guild's page.
type GuildMember struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Leader  bool   `json:"leader"`
	Officer bool   `json:"officer"`
	Admin   bool   `json:"admin"`
	Draw    bool   `json:"draw"`   // may withdraw past what its deposits earn
	Put     int64  `json:"put"`    // contribution, all time
	Season  int64  `json:"season"` // this season
}

// GuildWork is a work and its stock (GDD 4.14).
type GuildWork struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	On    bool       `json:"on"`
	Days  int64      `json:"days"` // days of stock left in the bank
	Uses  []CostLine `json:"uses"`
	Gives string     `json:"gives"`
	By    int64      `json:"by"`
	Needs string     `json:"needs,omitempty"`
	Waits string     `json:"waits,omitempty"`
	Can   bool       `json:"can"` // may be switched on here
}

// Approval is a payment waiting for a second officer.
type Approval struct {
	ID    string `json:"id"`
	By    string `json:"by"`
	To    string `json:"to"`
	What  string `json:"what"`
	Value int64  `json:"value"`
}

// GuildVote is an open motion.
type GuildVote struct {
	Target string `json:"target"`
	Role   string `json:"role"`
	For    int64  `json:"for"`
	Need   int64  `json:"need"`
}

// Charter is whether the character's tile can be chartered, and what it
// costs (GDD 4.8).
type Charter struct {
	Can    bool             `json:"can"`
	Why    string           `json:"why,omitempty"`
	Take   bool             `json:"take"` // a starting settlement taken over
	Coin   int64            `json:"coin"`
	Timber int64            `json:"timber"`
	Stone  int64            `json:"stone"`
	Fields map[string]int64 `json:"fields,omitempty"` // a Surveyor's view
}

// Guild is /guild: a character's guild, or what founding one takes.
type Guild struct {
	ID          string        `json:"id,omitempty"`
	Name        string        `json:"name,omitempty"`
	Server      bool          `json:"server"`
	Leader      string        `json:"leader,omitempty"`
	Members     []GuildMember `json:"members"`
	Officers    int64         `json:"officers"`
	OfficersMax int64         `json:"officersMax"`
	Full        bool          `json:"full"`
	Least       int64         `json:"least"`
	Treasury    int64         `json:"treasury"`
	Bank        []Goods       `json:"bank"`
	Works       []GuildWork   `json:"works"`
	Settlements []Settlement  `json:"settlements"`
	Approvals   []Approval    `json:"approvals"`
	Votes       []GuildVote   `json:"votes"`
	Invites     []string      `json:"invites"` // guilds that invited the character
	// Near are characters standing with an officer whom it could invite.
	Near    []Pick  `json:"near"`
	Officer bool    `json:"officer"`
	Spend   int64   `json:"spend"` // what an officer may still pay today
	Charter Charter `json:"charter"`
	Banner  string  `json:"banner"`
}

// Need is one threshold of a class's unlock and how far along it is.
type Need struct {
	What string `json:"what"`
	Have int64  `json:"have"`
	At   int64  `json:"at"`
}

// Ability is one entry of a tree.
type Ability struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Text  string `json:"text"`
	Taken bool   `json:"taken"`
	Waits string `json:"waits,omitempty"`
}

// Tier is one tier of a tree: the level it opens at and its two
// abilities.
type Tier struct {
	Level   int64     `json:"level"`
	Open    bool      `json:"open"`
	Options []Ability `json:"options"`
}

// Class is one class as /classes shows it.
type Class struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Leans  string `json:"leans"`
	Earned bool   `json:"earned"`
	Active bool   `json:"active"`
	First  bool   `json:"first"`
	Level  int64  `json:"level"`
	Needs  []Need `json:"needs"`
	Tiers  []Tier `json:"tiers"`
}

// Classes is /classes: every class found so far, earned or not, and how
// many may be active.
type Classes struct {
	Classes []Class `json:"classes"`
	Active  int64   `json:"active"`
	Most    int64   `json:"most"`
	// Here is whether the character stands in a settlement, where classes
	// are chosen.
	Here bool `json:"here"`
}
