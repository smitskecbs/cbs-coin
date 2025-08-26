use anchor_lang::prelude::*;

declare_id!("FZGYyZ9hwUBriGpCH65vswS2VDoCyoC92rPoBPeBsuUY");

const MAX_QUESTION_LEN: usize = 256; // ruimte in account

#[program]
pub mod cbs_dao {
    use super::*;

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        question: String,
        ends_at: i64,
        index: u32, // 🔹 NIEUW: index als seed + check tegen creator_state
    ) -> Result<()> {
        require!(question.len() <= MAX_QUESTION_LEN, ErrorCode::QuestionTooLong);

        let now = Clock::get()?.unix_timestamp;
        require!(ends_at > now, ErrorCode::AlreadyEnded);

        // Enforce index == next_index
        let state = &mut ctx.accounts.creator_state;
        require!(index == state.next_index, ErrorCode::IndexMismatch);

        let proposal = &mut ctx.accounts.proposal;
        proposal.creator    = ctx.accounts.creator.key();
        proposal.question   = question;
        proposal.yes_votes  = 0;
        proposal.no_votes   = 0;
        proposal.created_at = now;
        proposal.ends_at    = ends_at;

        state.next_index = state
            .next_index
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, yes: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= ctx.accounts.proposal.ends_at, ErrorCode::AlreadyEnded);

        let receipt = &mut ctx.accounts.vote_receipt;
        require!(!receipt.has_voted, ErrorCode::AlreadyVoted);

        receipt.proposal  = ctx.accounts.proposal.key();
        receipt.voter     = ctx.accounts.voter.key();
        receipt.has_voted = true;

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

#[derive(Accounts)]
#[instruction(question: String, ends_at: i64, index: u32)]
pub struct CreateProposal<'info> {
    // 🔹 CreatorState houdt de teller bij (init als hij nog niet bestaat)
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + CreatorState::MAX_SIZE,
        seeds = [b"creator_state", creator.key().as_ref()],
        bump
    )]
    pub creator_state: Account<'info, CreatorState>,

    // 🔹 Proposal met unieke seed: creator + index
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

#[account]
pub struct Proposal {
    pub creator:    Pubkey,  // 32
    pub question:   String,  // 4 + N (reserve bij alloc)
    pub yes_votes:  u64,     // 8
    pub no_votes:   u64,     // 8
    pub created_at: i64,     // 8
    pub ends_at:    i64,     // 8
}
impl Proposal {
    // 32 + (4 + 256) + 8 + 8 + 8 + 8 = 324 bytes
    pub const MAX_SIZE: usize = 32 + 4 + MAX_QUESTION_LEN + 8 + 8 + 8 + 8;
}

#[account]
pub struct VoteReceipt {
    pub proposal:  Pubkey, // 32
    pub voter:     Pubkey, // 32
    pub has_voted: bool,   // 1
}
impl VoteReceipt {
    pub const MAX_SIZE: usize = 32 + 32 + 1;
}

#[account]
pub struct CreatorState {
    pub next_index: u32, // start 0, telt op
}
impl CreatorState {
    pub const MAX_SIZE: usize = 4;
}

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
