use anchor_lang::prelude::*;

declare_id!("FZGYyZ9hwUBriGpCH65vswS2VDoCyoC92rPoBPeBsuUY");

const MAX_QUESTION_LEN: usize = 256;

#[program]
pub mod cbs_dao {
    use super::*;

    /// 1) Init: 1x per creator
    pub fn init_creator_state(ctx: Context<InitCreatorState>) -> Result<()> {
        let st = &mut ctx.accounts.creator_state;
        st.next_index = 0;
        Ok(())
    }

    /// 2) Create proposal met index (uniek per creator)
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        question: String,
        ends_at: i64,
        index: u32,
    ) -> Result<()> {
        require!(question.len() <= MAX_QUESTION_LEN, ErrorCode::QuestionTooLong);

        let now = Clock::get()?.unix_timestamp;
        require!(ends_at > now, ErrorCode::AlreadyEnded);

        // Enforce index == next_index
        let st = &mut ctx.accounts.creator_state;
        require!(index == st.next_index, ErrorCode::IndexMismatch);

        let p = &mut ctx.accounts.proposal;
        p.creator    = ctx.accounts.creator.key();
        p.question   = question;
        p.yes_votes  = 0;
        p.no_votes   = 0;
        p.created_at = now;
        p.ends_at    = ends_at;

        st.next_index = st.next_index.checked_add(1).ok_or(ErrorCode::Overflow)?;
        Ok(())
    }

    /// 3) Vote
    pub fn vote(ctx: Context<Vote>, yes: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= ctx.accounts.proposal.ends_at, ErrorCode::AlreadyEnded);

        let r = &mut ctx.accounts.vote_receipt;
        require!(!r.has_voted, ErrorCode::AlreadyVoted);

        r.proposal  = ctx.accounts.proposal.key();
        r.voter     = ctx.accounts.voter.key();
        r.has_voted = true;

        if yes {
            ctx.accounts.proposal.yes_votes =
                ctx.accounts.proposal.yes_votes.checked_add(1).ok_or(ErrorCode::Overflow)?;
        } else {
            ctx.accounts.proposal.no_votes =
                ctx.accounts.proposal.no_votes.checked_add(1).ok_or(ErrorCode::Overflow)?;
        }
        Ok(())
    }
}

/* ---------------------------- Accounts ---------------------------- */

#[derive(Accounts)]
pub struct InitCreatorState<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + CreatorState::MAX_SIZE,
        seeds = [b"creator_state", creator.key().as_ref()],
        bump
    )]
    pub creator_state: Account<'info, CreatorState>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(question: String, ends_at: i64, index: u32)]
pub struct CreateProposal<'info> {
    // LET OP: GEEN init_if_needed MEER
    #[account(
        mut,
        seeds = [b"creator_state", creator.key().as_ref()],
        bump
    )]
    pub creator_state: Account<'info, CreatorState>,

    #[account(
        init,
        payer = creator,
        space = 8 + Proposal::MAX_SIZE,
        seeds = [b"proposal", creator.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteReceipt::MAX_SIZE,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_receipt: Account<'info, VoteReceipt>,

    pub system_program: Program<'info, System>,
}

/* ---------------------------- Data ---------------------------- */

#[account]
pub struct Proposal {
    pub creator:    Pubkey,
    pub question:   String,  // 4 + N
    pub yes_votes:  u64,
    pub no_votes:   u64,
    pub created_at: i64,
    pub ends_at:    i64,
}
impl Proposal {
    // 32 + (4+256) + 8 + 8 + 8 + 8 = 324
    pub const MAX_SIZE: usize = 32 + 4 + MAX_QUESTION_LEN + 8 + 8 + 8 + 8;
}

#[account]
pub struct VoteReceipt {
    pub proposal:  Pubkey,
    pub voter:     Pubkey,
    pub has_voted: bool,
}
impl VoteReceipt {
    pub const MAX_SIZE: usize = 32 + 32 + 1;
}

#[account]
pub struct CreatorState {
    pub next_index: u32,
}
impl CreatorState {
    pub const MAX_SIZE: usize = 4;
}

/* ---------------------------- Errors ---------------------------- */

#[error_code]
pub enum ErrorCode {
    #[msg("Vraag is te lang")]
    QuestionTooLong, // 6000
    #[msg("Stemperiode is voorbij")]
    AlreadyEnded, // 6001
    #[msg("Je hebt al gestemd")]
    AlreadyVoted, // 6002
    #[msg("Overflow")]
    Overflow, // 6003
    #[msg("Index komt niet overeen met next_index")]
    IndexMismatch, // 6004
}
