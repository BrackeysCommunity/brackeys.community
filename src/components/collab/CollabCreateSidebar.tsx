import { ArrowLeft01Icon, ArrowRight01Icon, BriefcaseIcon, GameController01Icon, Login01Icon, MultiplicationSignIcon, Tick01Icon, UserGroupIcon, Image01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useForm } from '@tanstack/react-form'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import {
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
} from 'obscenity'
import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { CharCount, FieldError, MagneticFooterButton, SectionHeader } from '@/components/ui/form-primitives'
import { NotchedCard } from '@/components/ui/notched-card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { authStore } from '@/lib/auth-store'
import {
  type CollabCompensationType,
  type CollabContactType,
  type CollabExperienceLevel,
  type CollabPostType,
  type CollabProjectLength,
  type CollabSubtype,
  type CollabTeamSize,
  collabStore,
  getWizardSteps,
  resetWizard,
  setWizardStep,
  type UploadedImage,
  updateWizardDraft,
} from '@/lib/collab-store'
import { cn } from '@/lib/utils'
import { client, orpc } from '@/orpc/client'

// ── Profanity ────────────────────────────────────────────────────────────────

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

function profanityCheck(value: string, fieldName: string): string | undefined {
  if (value && profanityMatcher.hasMatch(value)) {
    return `${fieldName} contains inappropriate language.`
  }
  return undefined
}

// ── Layout helpers ───────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────

import type { IconSvgElement } from '@hugeicons/react'

const POST_TYPES: { value: CollabPostType; label: string; desc: string; icon: IconSvgElement }[] = [
  { value: 'paid', label: 'PAID WORK', desc: 'Paid gigs & contracts', icon: BriefcaseIcon },
  { value: 'hobby', label: 'HOBBY PROJECT', desc: 'Passion projects & jams', icon: GameController01Icon },
  { value: 'playtest', label: 'PLAYTEST', desc: 'Get feedback on your game', icon: MultiplicationSignIcon },
  { value: 'mentor', label: 'MENTORSHIP', desc: 'Teach or learn from others', icon: UserGroupIcon },
]

const SUBTYPES: { value: CollabSubtype; label: string }[] = [
  { value: 'hiring', label: 'HIRING' },
  { value: 'offering', label: 'OFFERING' },
]

const MENTOR_SUBTYPES: { value: CollabSubtype; label: string }[] = [
  { value: 'offering', label: 'I WANT TO MENTOR' },
  { value: 'hiring', label: 'I WANT A MENTOR' },
]

const PLATFORM_OPTIONS = ['PC', 'Mac', 'Linux', 'Web', 'iOS', 'Android', 'PS5', 'Xbox', 'Switch', 'VR']

const TEAM_SIZE_OPTIONS: { value: CollabTeamSize; label: string }[] = [
  { value: 'solo', label: 'Solo' },
  { value: '2-3', label: '2-3' },
  { value: '4-6', label: '4-6' },
  { value: '7+', label: '7+' },
]

const PROJECT_LENGTH_OPTIONS: { value: CollabProjectLength; label: string }[] = [
  { value: '<1 week', label: '< 1 wk' },
  { value: '1-4 weeks', label: '1-4 wks' },
  { value: '1-3 months', label: '1-3 mo' },
  { value: '3-6 months', label: '3-6 mo' },
  { value: '6+ months', label: '6+ mo' },
  { value: 'ongoing', label: 'Ongoing' },
]

const EXPERIENCE_LEVEL_OPTIONS: { value: CollabExperienceLevel; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'experienced', label: 'Experienced' },
]

const COMPENSATION_TYPE_OPTIONS: { value: CollabCompensationType; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'rev_share', label: 'Rev Share' },
  { value: 'negotiable', label: 'Negotiable' },
]

const CONTACT_TYPE_OPTIONS: { value: CollabContactType; label: string }[] = [
  { value: 'discord_dm', label: 'Discord DM' },
  { value: 'discord_server', label: 'Server' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
]

const FEEDBACK_TYPE_OPTIONS = ['Gameplay', 'UX/UI', 'Bugs', 'Balance', 'Story', 'Performance', 'General']

const PLAY_TIME_OPTIONS: { value: CollabProjectLength; label: string }[] = [
  { value: '<1 week', label: '< 15 min' },
  { value: '1-4 weeks', label: '15-30 min' },
  { value: '1-3 months', label: '30-60 min' },
  { value: '3-6 months', label: '1-2 hrs' },
  { value: '6+ months', label: '2+ hrs' },
]

const CONTACT_PLACEHOLDERS: Record<CollabContactType, string> = {
  discord_dm: 'Your Discord username',
  discord_server: 'discord.gg/your-server',
  email: 'you@example.com',
  other: 'How to reach you',
}

// ── Compensation slider config ───────────────────────────────────────────────

type CompSliderConfig = { min: number; max: number; step: number; defaultMin: number; defaultMax: number }

const COMP_SLIDER_CONFIG: Record<string, CompSliderConfig> = {
  hourly: { min: 5, max: 200, step: 5, defaultMin: 25, defaultMax: 75 },
  fixed: { min: 100, max: 25000, step: 100, defaultMin: 500, defaultMax: 5000 },
  rev_share: { min: 5, max: 100, step: 5, defaultMin: 10, defaultMax: 30 },
}

function formatCompensation(type: CollabCompensationType | undefined, min: number | undefined, max: number | undefined): string {
  if (!type || type === 'negotiable' || min === undefined) return ''
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`
  if (type === 'rev_share') {
    return max !== undefined ? `${min}% - ${max}%` : `${min}%+`
  }
  const suffix = type === 'hourly' ? ' /hr' : ''
  return max !== undefined ? `${fmt(min)} - ${fmt(max)}${suffix}` : `${fmt(min)}+${suffix}`
}

// ── Strapi upload ────────────────────────────────────────────────────────────

async function uploadToStrapi(file: File): Promise<UploadedImage> {
  const formData = new FormData()
  formData.append('files', file)

  const response = await fetch(`${import.meta.env.VITE_STRAPI_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) throw new Error('Upload failed')

  const data = await response.json()
  const uploaded = data[0]
  return {
    strapiMediaId: String(uploaded.id),
    url: uploaded.url.startsWith('http') ? uploaded.url : `${import.meta.env.VITE_STRAPI_URL}${uploaded.url}`,
  }
}

// ── Form types ───────────────────────────────────────────────────────────────

type WizardFormValues = {
  type: CollabPostType | undefined
  subtype: CollabSubtype | undefined
  title: string
  description: string
  isIndividual: boolean
  projectName: string
  platforms: string[]
  teamSize: CollabTeamSize | undefined
  projectLength: CollabProjectLength | undefined
  experienceLevel: CollabExperienceLevel | undefined
  compensationType: CollabCompensationType | undefined
  compensationMin: number | undefined
  compensationMax: number | undefined
  contactType: CollabContactType | undefined
  contactMethod: string
  portfolioUrl: string
  experience: string
  roleIds: number[]
  images: UploadedImage[]
}

// ── Reusable field components ────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T | undefined
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors ${value === opt.value ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted/10 border-muted/30 text-muted-foreground hover:border-primary/30'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MultiSelectChips({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string[]
  onChange: (v: string[]) => void
  options: string[]
}) {
  const toggle = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item))
    } else {
      onChange([...value, item])
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${value.includes(opt) ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted/10 border-muted/30 text-muted-foreground hover:border-primary/30'}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Compensation range selector ──────────────────────────────────────────────

function CompensationRangeSelector({
  compensationType,
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  compensationType: CollabCompensationType | undefined
  min: number | undefined
  max: number | undefined
  onMinChange: (v: number | undefined) => void
  onMaxChange: (v: number | undefined) => void
}) {
  const config = compensationType ? COMP_SLIDER_CONFIG[compensationType] : undefined

  const onMinRef = useRef(onMinChange)
  const onMaxRef = useRef(onMaxChange)
  onMinRef.current = onMinChange
  onMaxRef.current = onMaxChange

  useEffect(() => {
    if (!config) return
    if (min === undefined) onMinRef.current(config.defaultMin)
    if (max === undefined) onMaxRef.current(config.defaultMax)
  }, [config, min, max])

  if (!config) return null

  const currentMin = min ?? config.defaultMin
  const currentMax = max ?? config.defaultMax

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
        Rate Range
      </span>
      <div className="px-1">
        <Slider
          min={config.min}
          max={config.max}
          step={config.step}
          value={[currentMin, currentMax]}
          onValueChange={(newValue) => {
            if (Array.isArray(newValue)) {
              onMinChange(newValue[0])
              onMaxChange(newValue[1])
            }
          }}
        />
      </div>
      <p className="font-mono text-xs text-green-500 text-center tracking-wider">
        {formatCompensation(compensationType, currentMin, currentMax)}
      </p>
    </div>
  )
}

// ── Image upload component ───────────────────────────────────────────────────

function ImageUploader({
  images,
  onAdd,
  onRemove,
}: {
  images: UploadedImage[]
  onAdd: (img: UploadedImage) => void
  onRemove: (idx: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Only image files are allowed.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.')
      return
    }
    setUploadError('')
    setUploading(true)
    try {
      const uploaded = await uploadToStrapi(file)
      onAdd(uploaded)
    } catch {
      setUploadError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
        Project Images
      </span>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={img.strapiMediaId} className="relative group w-16 h-16">
              <img
                src={img.url}
                alt={img.alt ?? ''}
                className="w-full h-full object-cover border border-muted/30"
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="absolute -top-1 -right-1 bg-destructive text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <HugeiconsIcon icon={Delete02Icon} size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || images.length >= 5}
        className="flex items-center justify-center gap-2 border border-dashed border-muted/40 bg-muted/10 px-3 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <HugeiconsIcon icon={Image01Icon} size={14} />
        {uploading ? 'UPLOADING...' : images.length >= 5 ? 'MAX 5 IMAGES' : 'ADD IMAGE'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      {uploadError && <p className="font-mono text-[10px] text-destructive">{uploadError}</p>}
    </div>
  )
}

// ── Step Components ─────────────────────────────────────────────────────────

function StepTypeAndBasics() {
  const form = useWizardForm()
  return (
    <div className="space-y-0">
      <SectionHeader>Post Type</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <form.Field name="type">
          {(field) => (
            <>
              <div className="grid grid-cols-2 gap-2">
                {POST_TYPES.map((t) => {
                  const active = field.state.value === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        field.handleChange(t.value)
                        updateWizardDraft({ type: t.value })
                      }}
                      className={`flex flex-col gap-2 p-3 border-2 text-left transition-all ${active ? 'border-primary bg-primary/5 shadow-[0_0_12px_rgba(var(--color-primary-rgb),0.08)]' : 'border-muted/25 bg-muted/5 hover:border-primary/25 hover:bg-muted/10'}`}
                    >
                      <HugeiconsIcon icon={t.icon} size={16} className={active ? 'text-primary' : 'text-muted-foreground/40'} />
                      <div>
                        <span className={`block font-mono text-[10px] font-bold tracking-wider uppercase ${active ? 'text-primary' : 'text-foreground'}`}>
                          {t.label}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/50">{t.desc}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>
      </div>

      <form.Field name="type">
        {(typeField) => {
          const typeVal = typeField.state.value
          if (typeVal !== 'paid' && typeVal !== 'hobby' && typeVal !== 'mentor') return null

          return (
            <>
              <SectionHeader>Direction</SectionHeader>
              <div className="px-4 py-3 border-b border-muted/30">
                <form.Field name="subtype">
                  {(field) => {
                    const opts = typeVal === 'mentor' ? MENTOR_SUBTYPES : SUBTYPES
                    return (
                      <>
                        <div className="flex gap-1.5">
                          {opts.map((s) => (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => {
                                field.handleChange(s.value)
                                updateWizardDraft({ subtype: s.value })
                              }}
                              className={`flex-1 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest border transition-all ${field.state.value === s.value ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_8px_rgba(var(--color-primary-rgb),0.12)]' : 'bg-muted/5 border-muted/20 text-muted-foreground hover:border-primary/25 hover:text-foreground'}`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                        <FieldError errors={field.state.meta.errors.map(String)} />
                      </>
                    )
                  }}
                </form.Field>
              </div>
            </>
          )
        }}
      </form.Field>

      <form.Field name="type">
        {(typeField) => {
          if (!typeField.state.value) return null
          return (
            <>
              <SectionHeader>Posting As</SectionHeader>
              <div className="px-4 py-3 border-b border-muted/30">
                <form.Field name="isIndividual">
                  {(field) => (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Switch
                        checked={field.state.value}
                        onCheckedChange={(checked) => {
                          field.handleChange(!!checked)
                          updateWizardDraft({ isIndividual: !!checked })
                        }}
                      />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Posting as myself (use my Discord for contact)
                      </span>
                    </label>
                  )}
                </form.Field>
              </div>
            </>
          )
        }}
      </form.Field>

      <SectionHeader>Post Title</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <form.Field
          name="title"
          validators={{
            onChange: ({ value }: { value: string }) => {
              if (value.trim().length > 0 && value.trim().length < 10) return 'Title must be at least 10 characters.'
              return profanityCheck(value, 'Title')
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="e.g. Looking for pixel artist for RPG"
                maxLength={200}
                className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
              />
              <div className="flex justify-between items-center">
                <FieldError errors={field.state.meta.errors.map(String)} />
                <CharCount current={field.state.value.length} min={10} max={200} />
              </div>
            </div>
          )}
        </form.Field>
      </div>

      <SectionHeader>Description</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <form.Field
          name="description"
          validators={{
            onChange: ({ value }: { value: string }) => {
              if (value.trim().length > 0 && value.trim().length < 30) return 'Description must be at least 30 characters.'
              return profanityCheck(value, 'Description')
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <textarea
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Describe what you're looking for or offering..."
                maxLength={5000}
                rows={6}
                className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 resize-none transition-colors"
              />
              <div className="flex justify-between items-center">
                <FieldError errors={field.state.meta.errors.map(String)} />
                <CharCount current={field.state.value.length} min={30} max={5000} />
              </div>
            </div>
          )}
        </form.Field>
      </div>
    </div>
  )
}

function ContactViaDiscordNotice() {
  const { data: profile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
  })
  const username = profile?.profile?.discordUsername

  return (
    <>
      <SectionHeader>Contact</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-2">
        <div className="border border-primary/20 bg-primary/5 p-3 space-y-1">
          <p className="font-mono text-[10px] text-primary uppercase tracking-wider font-bold">
            Discord DM
          </p>
          <p className="font-mono text-xs text-foreground">
            {username ? `@${username}` : 'Loading...'}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Respondents will contact you via Discord DM.
          </p>
        </div>
      </div>
    </>
  )
}

function StepProjectDetails() {
  const form = useWizardForm()
  const typeVal = useStore(form.store, (s: AnyFormStore) => s.values.type)
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual)
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType)

  return (
    <div className="space-y-0">
      <SectionHeader>Project Details</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-3">
        <form.Field
          name="projectName"
          validators={{
            onChange: ({ value }: { value: string }) => {
              if (value.trim().length > 0 && value.trim().length < 3) return 'Project name must be at least 3 characters.'
              return profanityCheck(value, 'Project name')
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                Project Name *
              </label>
              <input
                type="text"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="My Awesome Game"
                maxLength={200}
                className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
              />
              <div className="flex justify-between items-center">
                <FieldError errors={field.state.meta.errors.map(String)} />
                <CharCount current={field.state.value.length} min={3} max={200} />
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="platforms">
          {(field) => (
            <>
              <MultiSelectChips
                label="Platforms *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PLATFORM_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="teamSize">
          {(field) => (
            <>
              <SegmentedControl
                label="Team Size *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={TEAM_SIZE_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="projectLength">
          {(field) => (
            <>
              <SegmentedControl
                label="Timeline *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PROJECT_LENGTH_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="experienceLevel">
          {(field) => (
            <>
              <SegmentedControl
                label="Experience Level *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={EXPERIENCE_LEVEL_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="images">
          {(field) => (
            <>
              <ImageUploader
                images={field.state.value}
                onAdd={(img) => field.handleChange([...field.state.value, img])}
                onRemove={(idx) => field.handleChange(field.state.value.filter((_: UploadedImage, i: number) => i !== idx))}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>
      </div>

      {typeVal === 'paid' && (
        <>
          <SectionHeader>Compensation</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 space-y-3">
            <form.Field name="compensationType">
              {(field) => (
                <>
                  <SegmentedControl
                    label="Compensation Type *"
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={COMPENSATION_TYPE_OPTIONS}
                  />
                  <FieldError errors={field.state.meta.errors.map(String)} />
                </>
              )}
            </form.Field>

            {compensationType && compensationType !== 'negotiable' && (
              <form.Field name="compensationMin">
                {(minField) => (
                  <form.Field name="compensationMax">
                    {(maxField) => (
                      <>
                        <CompensationRangeSelector
                          compensationType={compensationType}
                          min={minField.state.value}
                          max={maxField.state.value}
                          onMinChange={(v) => minField.handleChange(v)}
                          onMaxChange={(v) => maxField.handleChange(v)}
                        />
                        <FieldError errors={minField.state.meta.errors.map(String)} />
                      </>
                    )}
                  </form.Field>
                )}
              </form.Field>
            )}
          </div>
        </>
      )}

      {isIndividual ? (
        <ContactViaDiscordNotice />
      ) : (
        <>
          <SectionHeader>Contact</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 space-y-3">
            <form.Field name="contactType">
              {(field) => (
                <>
                  <SegmentedControl
                    label="Contact Type *"
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={CONTACT_TYPE_OPTIONS}
                  />
                  <FieldError errors={field.state.meta.errors.map(String)} />
                </>
              )}
            </form.Field>

            <form.Field name="contactType">
              {(ctField) => {
                const ct = ctField.state.value
                if (!ct) return null
                return (
                  <form.Field
                    name="contactMethod"
                    validators={{
                      onChange: ({ value }: { value: string }) => profanityCheck(value, 'Contact method'),
                    }}
                  >
                    {(field) => (
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                          Contact Info *
                        </label>
                        <input
                          type="text"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={CONTACT_PLACEHOLDERS[ct as CollabContactType]}
                          maxLength={500}
                          className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
                        />
                        <FieldError errors={field.state.meta.errors.map(String)} />
                      </div>
                    )}
                  </form.Field>
                )
              }}
            </form.Field>
          </div>
        </>
      )}
    </div>
  )
}

function StepYourProfile() {
  const form = useWizardForm()
  const typeVal = useStore(form.store, (s: AnyFormStore) => s.values.type)
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType)
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual)

  const { data: profile, isLoading } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
  })

  const p = profile?.profile
  const completenessItems = [
    { label: 'Avatar', ok: !!p?.avatarUrl },
    { label: 'Bio', ok: !!p?.bio },
    { label: 'Tagline', ok: !!p?.tagline },
    { label: 'Skills', ok: (profile?.skills?.length ?? 0) > 0 },
    { label: 'Projects', ok: (profile?.projects?.length ?? 0) > 0 },
    { label: 'GitHub', ok: !!p?.githubUrl },
    { label: 'Twitter', ok: !!p?.twitterUrl },
    { label: 'Website', ok: !!p?.websiteUrl },
  ]
  const completenessScore = completenessItems.filter((i) => i.ok).length

  return (
    <div className="space-y-0">
      <SectionHeader>Your Profile</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-3">
        {isLoading ? (
          <div className="py-4 text-center">
            <span className="font-mono text-[10px] text-muted-foreground animate-pulse tracking-widest uppercase">
              Loading profile...
            </span>
          </div>
        ) : profile ? (
          <>
            <div className="border border-muted/30 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center gap-3">
                {p?.avatarUrl ? (
                  <img src={p.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-muted/30" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted/30 border border-muted/30" />
                )}
                <div>
                  <p className="font-mono text-xs font-bold text-foreground">{p?.discordUsername ?? 'Unknown'}</p>
                  {p?.tagline && (
                    <p className="font-mono text-[10px] text-muted-foreground">{p.tagline}</p>
                  )}
                </div>
              </div>
              {profile.skills && profile.skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {profile.skills.slice(0, 6).map((skill: { id: number; name: string }) => (
                    <span key={skill.id} className="bg-primary/10 border border-primary/30 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
                      {skill.name}
                    </span>
                  ))}
                  {profile.skills.length > 6 && (
                    <span className="font-mono text-[10px] text-muted-foreground">+{profile.skills.length - 6}</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                  Profile Completeness
                </span>
                <span className="font-mono text-[10px] text-primary">{completenessScore}/8</span>
              </div>
              <div className="flex gap-0.5">
                {completenessItems.map((item, i) => (
                  <div key={i} className={`h-1.5 flex-1 ${item.ok ? 'bg-primary' : 'bg-muted/30'}`} title={item.label} />
                ))}
              </div>
            </div>

            {completenessScore < 5 && (
              <div className="border border-brackeys-yellow/30 bg-brackeys-yellow/5 p-3 space-y-2">
                <p className="font-mono text-[10px] text-brackeys-yellow">
                  Your profile is your pitch — a complete profile gets more responses.
                </p>
                <a
                  href="/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-mono text-[10px] text-primary hover:underline tracking-wider uppercase"
                >
                  Edit Profile &rarr;
                </a>
              </div>
            )}
          </>
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground/50">No profile found. Create one first.</p>
        )}
      </div>

      {typeVal === 'paid' && (
        <>
          <SectionHeader>Compensation</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 space-y-3">
            <form.Field name="compensationType">
              {(field) => (
                <>
                  <SegmentedControl
                    label="Compensation Type *"
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={COMPENSATION_TYPE_OPTIONS}
                  />
                  <FieldError errors={field.state.meta.errors.map(String)} />
                </>
              )}
            </form.Field>

            {compensationType && compensationType !== 'negotiable' && (
              <form.Field name="compensationMin">
                {(minField) => (
                  <form.Field name="compensationMax">
                    {(maxField) => (
                      <>
                        <CompensationRangeSelector
                          compensationType={compensationType}
                          min={minField.state.value}
                          max={maxField.state.value}
                          onMinChange={(v) => minField.handleChange(v)}
                          onMaxChange={(v) => maxField.handleChange(v)}
                        />
                        <FieldError errors={minField.state.meta.errors.map(String)} />
                      </>
                    )}
                  </form.Field>
                )}
              </form.Field>
            )}
          </div>
        </>
      )}

      <SectionHeader>Availability</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-3">
        <form.Field name="projectLength">
          {(field) => (
            <>
              <SegmentedControl
                label="How long are you available? *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PROJECT_LENGTH_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>
      </div>

      {isIndividual ? (
        <ContactViaDiscordNotice />
      ) : (
        <>
          <SectionHeader>Contact</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 space-y-3">
            <form.Field name="contactType">
              {(field) => (
                <>
                  <SegmentedControl
                    label="Contact Type *"
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={CONTACT_TYPE_OPTIONS}
                  />
                  <FieldError errors={field.state.meta.errors.map(String)} />
                </>
              )}
            </form.Field>

            <form.Field name="contactType">
              {(ctField) => {
                const ct = ctField.state.value
                if (!ct) return null
                return (
                  <form.Field
                    name="contactMethod"
                    validators={{
                      onChange: ({ value }: { value: string }) => profanityCheck(value, 'Contact method'),
                    }}
                  >
                    {(field) => (
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                          Contact Info *
                        </label>
                        <input
                          type="text"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={CONTACT_PLACEHOLDERS[ct as CollabContactType]}
                          maxLength={500}
                          className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
                        />
                        <FieldError errors={field.state.meta.errors.map(String)} />
                      </div>
                    )}
                  </form.Field>
                )
              }}
            </form.Field>
          </div>
        </>
      )}
    </div>
  )
}

function StepPlaytestDetails() {
  const form = useWizardForm()
  const experience = useStore(form.store, (s: AnyFormStore) => s.values.experience)

  let feedbackTypes: string[] = []
  try {
    const parsed = JSON.parse(experience || '[]')
    feedbackTypes = Array.isArray(parsed) ? parsed : []
  } catch {
    feedbackTypes = []
  }

  const setFeedbackTypes = (types: string[]) => {
    form.setFieldValue('experience', JSON.stringify(types))
  }

  return (
    <div className="space-y-0">
      <SectionHeader>Playtest Details</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-3">
        <form.Field name="platforms">
          {(field) => (
            <>
              <MultiSelectChips
                label="Platforms *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PLATFORM_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="portfolioUrl">
          {(field) => (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                Link to Game/Demo
              </label>
              <input
                type="text"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://itch.io/your-game"
                maxLength={500}
                className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </div>
          )}
        </form.Field>

        <MultiSelectChips
          label="Feedback Types *"
          value={feedbackTypes}
          onChange={setFeedbackTypes}
          options={FEEDBACK_TYPE_OPTIONS}
        />

        <form.Field name="projectLength">
          {(field) => (
            <>
              <SegmentedControl
                label="Estimated Play Time *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PLAY_TIME_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="experienceLevel">
          {(field) => (
            <>
              <SegmentedControl
                label="Experience Level Needed *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={EXPERIENCE_LEVEL_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>
      </div>
    </div>
  )
}

function StepMentorDetails() {
  const form = useWizardForm()
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual)
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const { data: roles } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: { search: debouncedSearch || undefined } }),
  })

  const toggleRole = (roleId: number) => {
    const current = roleIds
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId]
    form.setFieldValue('roleIds', next)
  }

  return (
    <div className="space-y-0">
      <SectionHeader>Topics / Areas *</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search topics..."
          className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
        />
        {roleIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {roles
              ?.filter((r) => roleIds.includes(r.id))
              .map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => toggleRole(role.id)}
                  className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
                >
                  {role.name} &times;
                </button>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          {roles
            ?.filter((r) => !roleIds.includes(r.id))
            .map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => toggleRole(role.id)}
                className="bg-muted/10 border border-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hover:border-primary/30 hover:text-primary transition-colors"
              >
                {role.name}
              </button>
            ))}
        </div>
      </div>

      <SectionHeader>Details</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-3">
        <form.Field name="projectLength">
          {(field) => (
            <>
              <SegmentedControl
                label="Availability *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={PROJECT_LENGTH_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>

        <form.Field name="experienceLevel">
          {(field) => (
            <>
              <SegmentedControl
                label="Experience Level *"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={EXPERIENCE_LEVEL_OPTIONS}
              />
              <FieldError errors={field.state.meta.errors.map(String)} />
            </>
          )}
        </form.Field>
      </div>

      {isIndividual ? (
        <ContactViaDiscordNotice />
      ) : (
        <>
          <SectionHeader>Contact</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 space-y-3">
            <form.Field name="contactType">
              {(field) => (
                <>
                  <SegmentedControl
                    label="Contact Type *"
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={CONTACT_TYPE_OPTIONS}
                  />
                  <FieldError errors={field.state.meta.errors.map(String)} />
                </>
              )}
            </form.Field>

            <form.Field name="contactType">
              {(ctField) => {
                const ct = ctField.state.value
                if (!ct) return null
                return (
                  <form.Field
                    name="contactMethod"
                    validators={{
                      onChange: ({ value }: { value: string }) => profanityCheck(value, 'Contact method'),
                    }}
                  >
                    {(field) => (
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
                          Contact Info *
                        </label>
                        <input
                          type="text"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={CONTACT_PLACEHOLDERS[ct as CollabContactType]}
                          maxLength={500}
                          className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
                        />
                        <FieldError errors={field.state.meta.errors.map(String)} />
                      </div>
                    )}
                  </form.Field>
                )
              }}
            </form.Field>
          </div>
        </>
      )}
    </div>
  )
}

function StepRoles() {
  const form = useWizardForm()
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const { data: roles } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: { search: debouncedSearch || undefined } }),
  })

  const toggleRole = (roleId: number) => {
    const current = roleIds
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId]
    form.setFieldValue('roleIds', next)
  }

  return (
    <div className="space-y-0">
      <SectionHeader>Select Roles Needed</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roles..."
          className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      {roleIds.length > 0 && (
        <>
          <SectionHeader>Selected ({roleIds.length})</SectionHeader>
          <div className="px-4 py-3 border-b border-muted/30 flex flex-wrap gap-1">
            {roles
              ?.filter((r) => roleIds.includes(r.id))
              .map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => toggleRole(role.id)}
                  className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
                >
                  {role.name} &times;
                </button>
              ))}
          </div>
        </>
      )}

      <SectionHeader>Available Roles</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
          {roles
            ?.filter((r) => !roleIds.includes(r.id))
            .map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => toggleRole(role.id)}
                className="bg-muted/10 border border-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hover:border-primary/30 hover:text-primary transition-colors"
              >
                {role.name}
              </button>
            ))}
          {roles?.length === 0 && (
            <p className="font-mono text-[10px] text-muted-foreground/50">No roles found</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Review step ──────────────────────────────────────────────────────────────

function ReviewBadge({ value, color = 'primary' }: { value: string; color?: string }) {
  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 border-primary/30 text-primary',
    green: 'bg-green-500/10 border-green-500/30 text-green-500',
  }
  return (
    <span className={`inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${colorClasses[color] ?? colorClasses.primary}`}>
      {value}
    </span>
  )
}

const CONTACT_TYPE_LABELS: Record<string, string> = {
  discord_dm: 'Discord DM',
  discord_server: 'Discord Server',
  email: 'Email',
  other: 'Other',
}

function StepReview() {
  const form = useWizardForm()
  const v = useStore(form.store, (s: AnyFormStore) => s.values)

  const { data: roles } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
  })
  const selectedRoleNames = roles?.filter((r) => v.roleIds.includes(r.id)).map((r) => r.name) ?? []

  let feedbackTypes: string[] = []
  if (v.type === 'playtest') {
    try {
      feedbackTypes = JSON.parse(v.experience || '[]')
      if (!Array.isArray(feedbackTypes)) feedbackTypes = []
    } catch {
      feedbackTypes = []
    }
  }

  const compDisplay = formatCompensation(v.compensationType, v.compensationMin, v.compensationMax)

  const postTypeIcon = POST_TYPES.find((t) => t.value === v.type)?.icon

  return (
    <div className="space-y-0">
      <SectionHeader>Post Preview</SectionHeader>
      {/* Mock post card preview */}
      <div className="mx-4 my-3 border border-primary/20 bg-primary/3">
        <div className="px-4 pt-4 pb-3 border-b border-muted/20">
          <div className="flex items-start gap-3">
            {postTypeIcon && (
              <div className="shrink-0 w-8 h-8 border border-primary/20 bg-primary/5 flex items-center justify-center mt-0.5">
                <HugeiconsIcon icon={postTypeIcon} size={14} className="text-primary/60" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-mono text-xs font-bold text-foreground leading-tight">
                {v.title || <span className="text-muted-foreground/40 italic font-normal">Untitled post</span>}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {v.type && <ReviewBadge value={v.type} />}
                {v.subtype && <ReviewBadge value={v.subtype} />}
                {v.isIndividual && <ReviewBadge value="Individual" />}
              </div>
            </div>
          </div>
          {v.description && (
            <p className="font-mono text-[10px] text-muted-foreground/60 mt-2.5 leading-relaxed line-clamp-4 whitespace-pre-wrap">
              {v.description}
            </p>
          )}
        </div>
        {v.images.length > 0 && (
          <div className="flex gap-1.5 px-3 py-2 border-b border-muted/20">
            {v.images.slice(0, 3).map((img) => (
              <img key={img.strapiMediaId} src={img.url} alt={img.alt ?? ''} className="w-14 h-10 object-cover border border-muted/20" />
            ))}
            {v.images.length > 3 && (
              <div className="w-14 h-10 bg-muted/20 border border-muted/20 flex items-center justify-center">
                <span className="font-mono text-[10px] text-muted-foreground">+{v.images.length - 3}</span>
              </div>
            )}
          </div>
        )}
        <div className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground/50 space-y-1">
          {v.projectName && <span className="block">{v.projectName}</span>}
          {compDisplay && <span className="block text-green-500/70">{compDisplay}</span>}
          {v.platforms.length > 0 && <span className="block">{v.platforms.join(' · ')}</span>}
          {selectedRoleNames.length > 0 && <span className="block">{selectedRoleNames.slice(0, 4).join(', ')}{selectedRoleNames.length > 4 ? ` +${selectedRoleNames.length - 4}` : ''}</span>}
        </div>
      </div>
      <div className="px-4 py-3 border-b border-muted/30 space-y-2.5">
        {selectedRoleNames.length > 0 && (
          <div>
            <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
              {v.type === 'mentor' ? 'Topics' : 'Roles'}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedRoleNames.map((name) => (
                <ReviewBadge key={name} value={name} />
              ))}
            </div>
          </div>
        )}
        {feedbackTypes.length > 0 && (
          <div>
            <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">Feedback</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {feedbackTypes.map((ft) => <ReviewBadge key={ft} value={ft} />)}
            </div>
          </div>
        )}
        {v.portfolioUrl && (
          <div>
            <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase block">Game Link</span>
            <a href={v.portfolioUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-primary hover:underline break-all">{v.portfolioUrl}</a>
          </div>
        )}
        <div>
          <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase block">Contact</span>
          <span className="font-mono text-[10px] text-foreground">
            {v.isIndividual
              ? 'Discord DM (via your profile)'
              : v.contactMethod
              ? `${v.contactType ? (CONTACT_TYPE_LABELS[v.contactType] ?? v.contactType) + ': ' : ''}${v.contactMethod}`
              : '—'}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 bg-primary/3 border-t border-primary/10">
        <p className="font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
          Review carefully — once submitted your post will be live. You can edit or delete it from your profile at any time.
        </p>
      </div>
    </div>
  )
}

// ── Unauthenticated state ───────────────────────────────────────────────────

function UnauthenticatedSidebar() {
  return (
    <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
      <NotchedCard
        className="flex-1 min-h-0"
        scrollable={false}
      >
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h3 className="font-mono text-sm tracking-[0.2em] text-destructive uppercase">{'// ACCESS DENIED'}</h3>
            <p className="font-mono text-xs text-muted-foreground max-w-[240px]">
              Authenticate with Discord to create collab posts.
            </p>
            <button
              type="button"
              onClick={() => {
                import('@/lib/auth-client').then(({ authClient }) =>
                  authClient.signIn.social({ provider: 'discord' }),
                )
              }}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'border-primary/60 text-primary hover:bg-primary/10 hover:border-primary font-mono text-[10px] font-bold tracking-widest uppercase gap-2',
              )}
            >
              <HugeiconsIcon icon={Login01Icon} size={13} />
              Sign In with Discord
            </button>
          </div>
        </div>
      </NotchedCard>
    </div>
  )
}

// ── Per-step validation ──────────────────────────────────────────────────────

function getStepValidationError(stepId: string, v: WizardFormValues): string | null {
  switch (stepId) {
    case 'basics': {
      if (!v.type) return 'Please select a post type.'
      if ((v.type === 'paid' || v.type === 'hobby' || v.type === 'mentor') && !v.subtype) return 'Please select a direction.'
      if (!v.title.trim()) return 'Please enter a title.'
      if (v.title.trim().length < 10) return 'Title must be at least 10 characters.'
      if (!v.description.trim()) return 'Please enter a description.'
      if (v.description.trim().length < 30) return 'Description must be at least 30 characters.'
      const titleCheck = profanityCheck(v.title, 'Title')
      if (titleCheck) return titleCheck
      const descCheck = profanityCheck(v.description, 'Description')
      if (descCheck) return descCheck
      break
    }
    case 'details': {
      if (!v.projectName.trim()) return 'Project name is required.'
      if (v.projectName.trim().length < 3) return 'Project name must be at least 3 characters.'
      if (v.platforms.length === 0) return 'Please select at least one platform.'
      if (!v.teamSize) return 'Please select a team size.'
      if (!v.projectLength) return 'Please select a timeline.'
      if (!v.experienceLevel) return 'Please select an experience level.'
      if (v.type === 'paid') {
        if (!v.compensationType) return 'Please select a compensation type.'
        if (v.compensationType !== 'negotiable' && v.compensationMin === undefined) return 'Please select a compensation range.'
      }
      if (!v.isIndividual) {
        if (!v.contactType) return 'Please select a contact type.'
        if (!v.contactMethod.trim()) return 'Please enter contact info.'
      }
      const nameCheck = profanityCheck(v.projectName, 'Project name')
      if (nameCheck) return nameCheck
      if (v.contactMethod) {
        const contactCheck = profanityCheck(v.contactMethod, 'Contact method')
        if (contactCheck) return contactCheck
      }
      break
    }
    case 'profile': {
      if (v.type === 'paid') {
        if (!v.compensationType) return 'Please select a compensation type.'
        if (v.compensationType !== 'negotiable' && v.compensationMin === undefined) return 'Please select a compensation range.'
      }
      if (!v.projectLength) return 'Please select your availability.'
      if (!v.isIndividual) {
        if (!v.contactType) return 'Please select a contact type.'
        if (!v.contactMethod.trim()) return 'Please enter contact info.'
      }
      if (v.contactMethod) {
        const contactCheck = profanityCheck(v.contactMethod, 'Contact method')
        if (contactCheck) return contactCheck
      }
      break
    }
    case 'playtest': {
      if (v.platforms.length === 0) return 'Please select at least one platform.'
      if (!v.projectLength) return 'Please select estimated play time.'
      if (!v.experienceLevel) return 'Please select an experience level.'
      let feedbackTypes: string[] = []
      try { feedbackTypes = JSON.parse(v.experience || '[]') } catch { /* empty */ }
      if (!Array.isArray(feedbackTypes) || feedbackTypes.length === 0) return 'Please select at least one feedback type.'
      break
    }
    case 'mentor': {
      if (v.roleIds.length === 0) return 'Please select at least one topic.'
      if (!v.projectLength) return 'Please select your availability.'
      if (!v.experienceLevel) return 'Please select an experience level.'
      if (!v.isIndividual) {
        if (!v.contactType) return 'Please select a contact type.'
        if (!v.contactMethod.trim()) return 'Please enter contact info.'
      }
      if (v.contactMethod) {
        const contactCheck = profanityCheck(v.contactMethod, 'Contact method')
        if (contactCheck) return contactCheck
      }
      break
    }
    case 'roles': {
      break
    }
    case 'review': {
      if (!v.type) return 'Post type is missing.'
      if (!v.title.trim()) return 'Title is missing.'
      if (v.title.trim().length < 10) return 'Title must be at least 10 characters.'
      if (!v.description.trim()) return 'Description is missing.'
      if (v.description.trim().length < 30) return 'Description must be at least 30 characters.'
      break
    }
  }
  return null
}

// ── Form context ─────────────────────────────────────────────────────────────

// TanStack Form v1 has 12 generic type parameters on ReactFormExtendedApi,
// making explicit typing impractical. We use `any` for the context and cast
// through a helper hook. Field render callbacks use `AnyFieldApi`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFieldApi = { state: { value: any; meta: { errors: any[] } }; handleChange: (v: any) => void; handleBlur: () => void }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFormStore = { values: WizardFormValues; isSubmitting: boolean; [k: string]: any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WizardFormContext = createContext<any>(null)

function useWizardForm() {
  const form = useContext(WizardFormContext)
  if (!form) throw new Error('useWizardForm must be used within WizardFormContext')
  return form as {
    Field: React.FC<{ name: keyof WizardFormValues; validators?: Record<string, unknown>; children: (field: AnyFieldApi) => React.ReactNode }>
    store: import('@tanstack/store').Store<AnyFormStore>
    setFieldValue: (name: keyof WizardFormValues, value: unknown) => void
    handleSubmit: () => void
    state: AnyFormStore
  }
}

// ── Main Sidebar ────────────────────────────────────────────────────────────

function AuthenticatedSidebar() {
  const { wizard } = useStore(collabStore)
  const navigate = useNavigate()
  const [error, setError] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm({
    defaultValues: {
      type: wizard.draft.type,
      subtype: wizard.draft.subtype,
      title: wizard.draft.title,
      description: wizard.draft.description,
      isIndividual: wizard.draft.isIndividual,
      projectName: wizard.draft.projectName,
      platforms: wizard.draft.platforms,
      teamSize: wizard.draft.teamSize,
      projectLength: wizard.draft.projectLength,
      experienceLevel: wizard.draft.experienceLevel,
      compensationType: wizard.draft.compensationType,
      compensationMin: wizard.draft.compensationMin,
      compensationMax: wizard.draft.compensationMax,
      contactType: wizard.draft.contactType,
      contactMethod: wizard.draft.contactMethod,
      portfolioUrl: wizard.draft.portfolioUrl,
      experience: wizard.draft.experience,
      roleIds: wizard.draft.roleIds,
      images: wizard.draft.images,
    },
    onSubmit: async ({ value: v }) => {
      // Normalize portfolioUrl
      let portfolioUrl: string | undefined
      if (v.portfolioUrl.trim()) {
        const url = v.portfolioUrl.trim()
        portfolioUrl = /^https?:\/\//.test(url) ? url : `https://${url}`
      }

      // Format compensation from range
      const compensation = formatCompensation(v.compensationType, v.compensationMin, v.compensationMax) || undefined

      const post = await client.createPost({
        type: v.type!,
        subtype: v.subtype,
        title: v.title,
        description: v.description,
        projectName: v.projectName || undefined,
        compensation,
        compensationType: v.compensationType || undefined,
        teamSize: v.teamSize || undefined,
        projectLength: v.projectLength || undefined,
        platforms: v.platforms.length > 0 ? v.platforms : undefined,
        experience: v.experience || undefined,
        experienceLevel: v.experienceLevel || undefined,
        portfolioUrl,
        contactMethod: v.isIndividual ? undefined : (v.contactMethod || undefined),
        contactType: v.isIndividual ? 'discord_dm' : (v.contactType || undefined),
        isIndividual: v.isIndividual || undefined,
        roleIds: v.roleIds.length > 0 ? v.roleIds : undefined,
      })

      // Attach images after post creation
      if (v.images.length > 0) {
        await Promise.all(
          v.images.map((img, idx) =>
            client.addPostImage({
              postId: post.id,
              strapiMediaId: img.strapiMediaId,
              url: img.url,
              alt: img.alt,
              sortOrder: idx,
            }),
          ),
        )
      }

      resetWizard()
      navigate({ to: '/collab/$postId', params: { postId: String(post.id) } })
    },
  })

  // Sync key fields to store so CollabCreatePage can compute steps
  const formType = useStore(form.store, (s) => s.values.type)
  const formSubtype = useStore(form.store, (s) => s.values.subtype)
  const formIsIndividual = useStore(form.store, (s) => s.values.isIndividual)

  useEffect(() => {
    updateWizardDraft({ type: formType, subtype: formSubtype, isIndividual: formIsIndividual })
  }, [formType, formSubtype, formIsIndividual])

  const steps = getWizardSteps({ type: formType, subtype: formSubtype, isIndividual: formIsIndividual })
  const currentStepDef = steps[wizard.step]
  const isLastStep = wizard.step === steps.length - 1

  const handleNext = () => {
    const values = form.state.values
    const validationError = getStepValidationError(currentStepDef?.id ?? '', values)
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')

    if (isLastStep) {
      form.handleSubmit()
    } else {
      setWizardStep(wizard.step + 1)
    }
  }

  const handleBack = () => {
    setError('')
    if (wizard.step > 0) {
      setWizardStep(wizard.step - 1)
    }
  }

  const renderStep = () => {
    if (!currentStepDef) return null
    switch (currentStepDef.id) {
      case 'basics':
        return <StepTypeAndBasics />
      case 'details':
        return <StepProjectDetails />
      case 'profile':
        return <StepYourProfile />
      case 'playtest':
        return <StepPlaytestDetails />
      case 'mentor':
        return <StepMentorDetails />
      case 'roles':
        return <StepRoles />
      case 'review':
        return <StepReview />
      default:
        return null
    }
  }

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting)

  return (
    <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
      <NotchedCard
        className="flex-1 min-h-0"
        header={
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
                {'NEW POST // STEP '}{wizard.step + 1}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {currentStepDef?.label}
              </span>
            </div>
            <div className="flex gap-0.5">
              {steps.map((step, i) => (
                <div
                  key={step.id}
                  className={`h-0.5 flex-1 transition-colors ${i <= wizard.step ? 'bg-primary' : 'bg-muted/30'}`}
                />
              ))}
            </div>
          </div>
        }
        footer={
          <>
            {error && (
              <div className="px-4 py-2 border-b border-destructive/30 bg-destructive/5">
                <p className="font-mono text-[10px] text-destructive">{error}</p>
              </div>
            )}
            <div className="px-6 py-4 flex gap-4">
              {wizard.step > 0 && (
                <MagneticFooterButton
                  onClick={handleBack}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'w-full border-muted/40 text-muted-foreground hover:bg-muted/10 hover:border-muted font-mono text-[10px] font-bold tracking-widest uppercase justify-between',
                  )}
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
                  Back
                </MagneticFooterButton>
              )}
              <MagneticFooterButton
                onClick={handleNext}
                disabled={isSubmitting}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'w-full border-primary/40 text-primary hover:bg-primary/10 hover:border-primary font-mono text-[10px] font-bold tracking-widest uppercase justify-between disabled:opacity-30 disabled:cursor-not-allowed',
                )}
              >
                {isLastStep ? (isSubmitting ? 'SUBMITTING...' : 'SUBMIT') : 'Next'}
                <HugeiconsIcon icon={isLastStep ? Tick01Icon : ArrowRight01Icon} size={13} />
              </MagneticFooterButton>
            </div>
          </>
        }
      >
        <WizardFormContext.Provider value={form}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentStepDef?.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </WizardFormContext.Provider>
      </NotchedCard>
    </div>
  )
}

export function CollabCreateSidebar() {
  const { session, isPending } = useStore(authStore)

  if (isPending) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <span className="font-mono text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
          Authenticating...
        </span>
      </div>
    )
  }

  if (!session?.user) {
    return <UnauthenticatedSidebar />
  }

  return <AuthenticatedSidebar />
}
