from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db, SessionLocal
import uuid
import time
import random

router = APIRouter(
    prefix="/api/submissions",
    tags=["submissions"],
)

def process_submission(submission_id: str):
    """
    Simulate the automated review pipeline (Security Gate, Functional Check).
    """
    db = SessionLocal()
    try:
        submission = db.query(models.Submission).filter(models.Submission.id == submission_id).first()
        if not submission:
            return

        # Simulate processing time
        time.sleep(5)

        # Mock Security Check
        security_score = random.randint(20, 30) # Max 30

        # Mock Functional Check
        functional_score = random.randint(30, 40) # Max 40

        submission.security_score = security_score
        submission.functional_score = functional_score
        submission.trust_score = security_score + functional_score

        # Auto decision logic
        if submission.trust_score >= 60:
             submission.auto_decision = "requires_human_review"
        else:
             submission.auto_decision = "auto_rejected"

        submission.state = "under_review"

        db.commit()
    finally:
        db.close()

@router.post("/", response_model=schemas.Submission)
def create_submission(
    submission: schemas.SubmissionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    db_submission = models.Submission(
        id=str(uuid.uuid4()),
        agent_id=submission.agent_id,
        card_document=submission.card_document,
        endpoint_manifest=submission.endpoint_manifest,
        endpoint_snapshot_hash=submission.endpoint_snapshot_hash,
        signature_bundle=submission.signature_bundle,
        organization_meta=submission.organization_meta,
        request_context=submission.request_context,
        state="submitted",
        # Initial scores
        trust_score=0,
        security_score=0,
        functional_score=0,
        judge_score=0,
        implementation_score=0,
        score_breakdown={},
        auto_decision=None
    )
    db.add(db_submission)
    db.commit()
    db.refresh(db_submission)

    # Trigger background processing
    background_tasks.add_task(process_submission, db_submission.id)

    return db_submission

@router.get("/", response_model=List[schemas.Submission])
def read_submissions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    submissions = db.query(models.Submission).offset(skip).limit(limit).all()
    return submissions

@router.get("/{submission_id}", response_model=schemas.Submission)
def read_submission(submission_id: str, db: Session = Depends(get_db)):
    submission = db.query(models.Submission).filter(models.Submission.id == submission_id).first()
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return submission
