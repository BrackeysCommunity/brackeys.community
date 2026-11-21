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
	// Dungeon ("q,r", its entrance) and Floor: Reach that floor or deeper.
	Dungeon string `json:"dungeon,omitempty"`
	Floor   int64  `json:"floor,omitempty"`
}

// GoalSpec is a goal as its poster specifies it.
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
	ID     string `json:"id"`
	Title  string `json:"title"`
	Note   string `json:"note,omitempty"`
	Issuer string `json:"issuer"` // its kind
	By     string `json:"by"`     // who issued it, by name
	Verb   string `json:"verb"`
	What   string `json:"what"` // the condition in words
	Where  string `json:"where,omitempty"`
	// From is where a Haul's stock starts, or where a Carry's downed
	// character lies now.
	From string `json:"from,omitempty"`
	// Reward is the coin on offer; a proposal's is what is pledged so far.
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
	// Even: a pooled goal pays everyone the same, not by contribution.
	Even bool `json:"even,omitempty"`
	// Evolved marks the world day its target evolved, when its issuer may
	// withdraw it whatever has been claimed.
	Evolved bool `json:"evolved,omitempty"`
	// Takes are the goods the viewer carries that a Deliver still takes
	// from it; Haul is whether the viewer may take its stock here, or
	// deliver it here.
	Takes []Goods `json:"takes"`
	Haul  string  `json:"haul,omitempty"` // take, deliver
	// CanPledge: the goal takes pledges. CanWithdraw: the viewer may take
	// it down now.
	CanPledge   bool   `json:"canPledge"`
	CanWithdraw bool   `json:"canWithdraw"`
	Building    string `json:"building,omitempty"` // the structure a raise goal builds
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

// Goals is /goals for a character: the board of the settlement it stands
// in, drafts, its own goals and the hauls it carries wherever they hang,
// and the rules a post is checked against. Away from a settlement
// Settlement is -1 and only Mine is filled.
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
	EachCap     int64    `json:"eachCap"` // the most claimants an Each goal pays
	Verbs       []string `json:"verbs"`
	Officer     bool     `json:"officer"`
	Coin        int64    `json:"coin"`
	Banner      string   `json:"banner"`
	// Targets are what each verb may be posted against from here; Gauge,
	// Line, Within and Ephemeral are the defaults the form fills in: a
	// Hold's gauge and its line, a Discover's reach in tiles, an ephemeral
	// goal's ticks.
	Targets   []Targets `json:"targets"`
	Gauge     string    `json:"gauge"`
	Line      int64     `json:"line"`
	Within    int64     `json:"within"`
	Ephemeral int64     `json:"ephemeral"`
	// EphemeralLeast and EphemeralMost are the ticks an ephemeral goal may
	// last.
	EphemeralLeast int64 `json:"ephemeralLeast"`
	EphemeralMost  int64 `json:"ephemeralMost"`
	At             Hex   `json:"at"`
	// Gauges are the region gauges a Hold may be posted on, each with the
	// lines the form offers; Sides the sides of a line it may be held on.
	Gauges []HoldGauge `json:"gauges"`
	Sides  []Pick      `json:"sides"`
	// What the form may narrow a goal by: a trait a made item must carry,
	// a region the creature must be defeated in, a generated field a
	// discovered tile must reach, and the things a vow may hold off.
	Traits []Pick `json:"traits"`
	Places []Pick `json:"places"`
	Fields []Pick `json:"fields"`
	Vows   []Pick `json:"vows"`
	// Party are the characters standing here a party goal may name, and
	// PartyMost how many it may.
	Party     []Pick `json:"party"`
	PartyMost int64  `json:"partyMost"`
	// Even: the character may post a pooled goal that pays everyone the
	// same (GDD 5.9).
	Even bool `json:"even"`
	// Waiting are goods goals handed the character that wait where they
	// were handed over; it takes them by acting there.
	Waiting []Waiting `json:"waiting"`
}

// The sides of its line a Hold's gauge is held on.
const (
	SideBelow = "below"
	SideAbove = "above"
)

// HoldGauge is a region gauge a Hold may be posted on, and the lines the
// form offers for it.
type HoldGauge struct {
	Value string  `json:"value"`
	Label string  `json:"label"`
	Lines []int64 `json:"lines"`
}

// Waiting is goods that wait for a character at a place.
type Waiting struct {
	Place string  `json:"place"`
	Goods []Goods `json:"goods"`
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
	// Hidden are the public goals an operator has hidden: a post of one
	// loses its words.
	Hidden []string `json:"hidden,omitempty"`
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
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Tier      int64  `json:"tier"`
	MaxTier   int64  `json:"maxTier"`
	Condition int64  `json:"condition"`
	Closed    bool   `json:"closed"`
	// Stands: it has been built here, whatever its tier.
	Stands  bool       `json:"stands"`
	Raising bool       `json:"raising"`
	Next    []CostLine `json:"next,omitempty"`
	// CanRaise: goals raise it a tier, no raise of it is open and the
	// system that reads that tier is built.
	CanRaise bool `json:"canRaise"`
	// Waits is the milestone its next raise waits for, if its system is not
	// built yet.
	Waits string `json:"waits,omitempty"`
	// RewardMost is the most coin the viewer could put on each line of its
	// raise now: what the treasury and the viewer's day cover, fees
	// included. 0 when no reward fits.
	RewardMost int64 `json:"rewardMost"`
	// Repairs are the steps a worn structure can be mended by, smallest
	// first; a closed one's first reopens it.
	Repairs []Repair `json:"repairs,omitempty"`
}

// Repair is points of a structure's condition and what restoring them
// takes.
type Repair struct {
	Points int64      `json:"points"`
	Cost   []CostLine `json:"cost"`
}

// Settlement is a settlement a guild runs.
type Settlement struct {
	N          int         `json:"n"`
	Name       string      `json:"name"`
	Treasury   int64       `json:"treasury"`
	Structures []Structure `json:"structures"`
	Here       bool        `json:"here"`
	// ConditionMax is a structure's condition in full repair.
	ConditionMax int64 `json:"conditionMax"`
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
	// CanPromote: the viewer may name it an officer. Removable is the role
	// a vote may stand against it in, if any.
	CanPromote bool   `json:"canPromote"`
	Removable  string `json:"removable,omitempty"`
	// PayGoods: the viewer may pay it goods from the bank now, both
	// standing where the bank is.
	PayGoods bool `json:"payGoods"`
}

// BankStock is one of the bank's stocks: what a unit is worth at cost,
// which a draw pays the treasury and a payment counts against an officer's
// day, and the most the viewer may draw where it stands.
type BankStock struct {
	Material string `json:"material"`
	Units    int64  `json:"units"`
	Value    int64  `json:"value"`
	Draw     int64  `json:"draw"`
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
	Can   bool       `json:"can"` // the viewer may switch it on, or off, here
	// Spares says the work gives coin its members keep; Ran, Used and Gave
	// are then the world days it has been stocked here since it was
	// switched on, and the coin value it has consumed and spared in them.
	Spares bool  `json:"spares,omitempty"`
	Ran    int64 `json:"ran,omitempty"`
	Used   int64 `json:"used,omitempty"`
	Gave   int64 `json:"gave,omitempty"`
}

// Approval is a payment waiting for a second officer.
type Approval struct {
	ID string `json:"id"`
	By string `json:"by"`
	To string `json:"to"`
	// Material and Units are what is paid; no Material is coin.
	Material string `json:"material,omitempty"`
	Units    int64  `json:"units"`
	Value    int64  `json:"value"`
	// Goods marks a payment out of the bank, approved where the bank is.
	Goods bool `json:"goods"`
	// Can: the viewer may approve it where it stands.
	Can bool `json:"can"`
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
	ID      string        `json:"id,omitempty"`
	Name    string        `json:"name,omitempty"`
	Server  bool          `json:"server"`
	Leader  string        `json:"leader,omitempty"`
	Members []GuildMember `json:"members"`
	// Officers are those who may spend and approve: the leader, a server's
	// admins and the officers named. Named of OfficersMax are named.
	Officers    int64       `json:"officers"`
	Named       int64       `json:"named"`
	OfficersMax int64       `json:"officersMax"`
	Full        bool        `json:"full"`
	Least       int64       `json:"least"`
	Treasury    int64       `json:"treasury"`
	Bank        []BankStock `json:"bank"`
	// BankHere: the character stands in a settlement the guild runs, where
	// goods go into and out of the bank; coin moves from anywhere.
	BankHere    bool         `json:"bankHere"`
	Works       []GuildWork  `json:"works"`
	Settlements []Settlement `json:"settlements"`
	Approvals   []Approval   `json:"approvals"`
	Votes       []GuildVote  `json:"votes"`
	Invites     []Pick       `json:"invites"` // guilds that invited the character
	// Near are characters standing with an officer whom it could invite.
	Near    []Pick `json:"near"`
	Officer bool   `json:"officer"`
	Spend   int64  `json:"spend"` // what an officer may still pay today
	// DrawShare is the per cent of its gifts a member may draw at cost.
	DrawShare int64   `json:"drawShare"`
	Charter   Charter `json:"charter"`
	Banner    string  `json:"banner"`
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
	// Prey is set for a character with Mark prey.
	Prey *Prey `json:"prey,omitempty"`
}

// Prey is a Stalker's mark (GDD 5.9): the creature tags it may name and
// the one it named today.
type Prey struct {
	Tags  []string `json:"tags"`
	Today string   `json:"today,omitempty"`
}
