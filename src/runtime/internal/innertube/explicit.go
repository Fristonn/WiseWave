package innertube

func rendererIsExplicit(value any) bool {
	switch node := value.(type) {
	case *jsonObject:
		for _, member := range node.members {
			if member.key == "iconType" && (member.value == "MUSIC_EXPLICIT_BADGE" || member.value == "EXPLICIT") {
				return true
			}
			if rendererIsExplicit(member.value) {
				return true
			}
		}
	case map[string]interface{}:
		for key, child := range node {
			if key == "iconType" && (child == "MUSIC_EXPLICIT_BADGE" || child == "EXPLICIT") {
				return true
			}
			if rendererIsExplicit(child) {
				return true
			}
		}
	case []interface{}:
		for _, child := range node {
			if rendererIsExplicit(child) {
				return true
			}
		}
	}
	return false
}
