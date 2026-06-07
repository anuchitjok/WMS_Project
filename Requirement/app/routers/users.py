from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
import models, auth as auth_utils

router = APIRouter(prefix="/api/users", tags=["users"])

class UserCreate(BaseModel):
    username: str
    full_name: str
    email: Optional[str] = None
    password: str
    role: str = "requester"
    department: Optional[str] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None

class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: Optional[str]
    role: str
    department: Optional[str]
    is_active: bool
    class Config: from_attributes = True

def admin_only(u=Depends(auth_utils.require_roles(models.UserRole.SYSTEM_ADMIN))):
    return u

@router.get("/", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db),
               current_user=Depends(auth_utils.require_roles(
                   models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER))):
    return db.query(models.User).all()

@router.post("/", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(admin_only)):
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(400, "Username already exists")
    user = models.User(
        username=data.username, full_name=data.full_name,
        email=data.email, role=data.role, department=data.department,
        password=auth_utils.hash_password(data.password)
    )
    db.add(user); db.commit(); db.refresh(user)
    return user

@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(admin_only)):
    user = db.query(models.User).get(user_id)
    if not user: raise HTTPException(404, "User not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit(); db.refresh(user)
    return user

@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(admin_only)):
    user = db.query(models.User).get(user_id)
    if not user: raise HTTPException(404, "User not found")
    user.is_active = False
    db.commit()
    return {"message": "User deactivated"}
