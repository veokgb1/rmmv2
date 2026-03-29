# STATE MODEL

## 当前状态变量

### currentCandidate
当前候选记录（仅内存）

### candidateConfirmed
是否已确认（布尔）

---

## 生命周期

输入 → 生成 candidate  
→ candidateConfirmed = false  

点击确认  
→ candidateConfirmed = true  

生成新候选  
→ candidateConfirmed = false  

关闭弹层  
→ 清空全部状态