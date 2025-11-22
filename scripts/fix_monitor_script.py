
import os

file_path = '/Users/vitalik/Desktop/Code/copilot/nof1.ai/public/monitor-script.js'

with open(file_path, 'r') as f:
    lines = f.readlines()

# Find occurrences of renderAccountCard
indices = [i for i, line in enumerate(lines) if 'renderAccountCard(account) {' in line]

print(f"Found renderAccountCard at lines: {[i+1 for i in indices]}")

if len(indices) < 2:
    print("No duplicate found.")
    exit()

# The second occurrence starts the duplicate block
start_index = indices[1]

# Find the end of the class (last '}' before the end of file, or before initialization code)
# We know the class ends around line 8300 (in original file).
# Let's look for the second 'hideActivateConfirmation' and find the closing brace after it.

hide_indices = [i for i, line in enumerate(lines) if 'hideActivateConfirmation(accountId) {' in line]
print(f"Found hideActivateConfirmation at lines: {[i+1 for i in hide_indices]}")

if len(hide_indices) < 2:
    print("No duplicate hideActivateConfirmation found. Using end of file heuristic.")
    # Fallback: delete from start_index to end of class
else:
    # The duplicate block ends after the second hideActivateConfirmation
    last_hide_index = hide_indices[-1]
    # Find the next '}' which closes the class
    # hideActivateConfirmation has ~6 lines.
    # So we look for '}' at indentation level 0 or 1?
    # The class closing brace is usually at indentation 0.
    
    end_index = -1
    for i in range(last_hide_index, len(lines)):
        if lines[i].strip() == '}':
            end_index = i
            break
    
    if end_index != -1:
        print(f"Deleting from line {start_index+1} to {end_index}") 
        
        # We delete from start_index (inclusive) to end_index (exclusive).
        # So we keep the '}' at end_index.
        
        del lines[start_index:end_index]
        
        with open(file_path, 'w') as f:
            f.writelines(lines)
        print("File updated.")
    else:
        print("Could not find end of duplicate block.")
